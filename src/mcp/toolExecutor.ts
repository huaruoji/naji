/**
 * Tool Executor — MCP 工具执行循环（ReAct）
 *
 * 复用 PetGPT 的 callLLMWithTools 核心设计。
 */
import { callLLM } from '../llm/index.js';
import type { Message, LlmConfig, ToolDefinition, ToolCall, ToolResult, LlmResponse } from '../types.js';
import { createAssistantToolCallMessage, formatToolResultMessage } from '../llm/openaiAdapter.js';
import type { McpClient } from './client.js';

const DECISION_TOOL_NAMES = new Set(['reply', 'silent']);
type ToolPhase = 'gather' | 'decide';

function isSuccessfulDecisionResult(result: string | undefined): boolean {
  return String(result ?? '').startsWith('[OK]');
}

/** LLM 调用重试：指数退避 1s → 3s → 10s */
const RETRY_DELAYS = [1000, 3000, 10000];
async function callLLMWithRetry(
  llmConfig: LlmConfig,
  messages: Message[],
  tools?: ToolDefinition[],
  options?: { temperature?: number; maxTokens?: number }
): Promise<LlmResponse> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      return await callLLM(llmConfig, messages, tools, options);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < RETRY_DELAYS.length) {
        const delay = RETRY_DELAYS[attempt];
        console.warn(`[LLM] Retry ${attempt + 1}/${RETRY_DELAYS.length} in ${delay}ms: ${lastError.message.slice(0, 120)}`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastError || new Error('LLM call failed after retries');
}

export interface ToolExecuteOptions {
  llmConfig: LlmConfig;
  messages: Message[];
  mcpClient?: McpClient;
  /** 允许暴露给 LLM 的 MCP 工具（不传则默认全部暴露） */
  visibleMcpTools?: ToolDefinition[];
  /** 内置工具映射 */
  builtinTools?: Map<string, (args: Record<string, unknown>) => Promise<string>>;
  /** 每次工具迭代后的回调 */
  onToolCall?: (name: string, args: Record<string, unknown>, result: string) => void;
  /** 最大迭代次数 */
  maxIterations?: number;
  /** 停止条件：工具名匹配时停止 */
  stopAfterTool?: string | ((name: string, result: string) => boolean);
  /** LLM 调用的额外选项 */
  temperature?: number;
}

export interface ToolExecuteResult {
  content: string;
  reasoningContent?: string;
  toolCallHistory: Array<{ name: string; args: Record<string, unknown>; result: string }>;
  usage: { inputTokens: number; outputTokens: number; cachedTokens: number };
}

/**
 * 执行 LLM + 工具循环
 * 1. 调用 LLM → 如果有工具调用 → 执行工具 → 结果追加到消息 → 重复
 * 2. 没有工具调用 → 返回结果
 */
export async function executeWithTools(
  options: ToolExecuteOptions
): Promise<ToolExecuteResult> {
  const {
    llmConfig,
    messages: initialMessages,
    mcpClient,
    visibleMcpTools,
    builtinTools,
    onToolCall,
    maxIterations = 25,
    stopAfterTool,
    temperature,
  } = options;

  const messages = [...initialMessages];
  const toolCallHistory: Array<{ name: string; args: Record<string, unknown>; result: string }> = [];
  let totalUsage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };
  let phase: ToolPhase = 'gather';

  // 获取所有可用工具定义
  const mcpTools = visibleMcpTools ?? (mcpClient?.getTools() || []);
  const allTools: ToolDefinition[] = [...mcpTools];

  // 添加内置工具定义
  if (builtinTools) {
    for (const [name] of builtinTools) {
      const isDecision = name === 'reply' || name === 'silent';
      allTools.push({
        name,
        description: isDecision
          ? name === 'reply'
            ? '回复群友/好友。content 就是你要说的话，reply_to 可选引用消息 ID（[#ID] 中的数字）。系统会自动发送消息。'
            : '沉默/围观，不回复。不需要参数。'
          : `内置工具: ${name}`,
        inputSchema: isDecision
          ? name === 'reply'
            ? {
                type: 'object',
                properties: {
                  content: { type: 'string', description: '回复内容（你要说的话）' },
                  reply_to: { type: 'string', description: '（可选）要引用的消息 ID，如 "123456"' },
                },
                required: ['content'],
              }
            : { type: 'object', properties: {} }
          : { type: 'object', properties: {} },
      });
    }
  }

  const gatherTools = allTools.filter(tool => !DECISION_TOOL_NAMES.has(tool.name));
  const decisionTools = allTools.filter(tool => DECISION_TOOL_NAMES.has(tool.name));

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    // 调用 LLM
    const availableTools = phase === 'gather' ? gatherTools : decisionTools;
    const response = await callLLMWithRetry(llmConfig, messages, availableTools, { temperature });
    const { content, reasoningContent, toolCalls, usage } = response;

    // 累计 usage
    if (usage) {
      totalUsage.inputTokens += usage.inputTokens;
      totalUsage.outputTokens += usage.outputTokens;
      totalUsage.cachedTokens += usage.cachedTokens || 0;
    }

    // 没有工具调用
    if (!toolCalls || toolCalls.length === 0) {
      if (phase === 'gather') {
        // 如果还没调用过任何非决策工具，不要跳到 decide — 让模型先收集信息
        const hasDoneRealWork = toolCallHistory.some(
          t => t.name !== 'reply' && t.name !== 'silent'
        );
        if (!hasDoneRealWork) {
          messages.push({ role: 'assistant', content: content || '' });
          if (reasoningContent) {
            messages[messages.length - 1].reasoning_content = reasoningContent;
          }
          messages.push({
            role: 'user',
            content: '[系统消息] 你还没有使用任何信息收集工具（如 web_search、social_read 等），请先用工具获取信息后再做决策。',
          });
          continue;
        }
        messages.push({ role: 'assistant', content: content || '' });
        if (reasoningContent) {
          messages[messages.length - 1].reasoning_content = reasoningContent;
        }
        messages.push({
          role: 'user',
          content: '[系统消息] 信息读取阶段结束。现在进入最终决策阶段：下一轮只能调用 reply(content) 或 silent()，不要再读取文件。',
        });
        phase = 'decide';
        continue;
      }

      const lastCall = toolCallHistory[toolCallHistory.length - 1];
      const decided =
        (lastCall?.name === 'reply' || lastCall?.name === 'silent') &&
        isSuccessfulDecisionResult(lastCall?.result);
      if (decided) {
        return {
          content,
          reasoningContent,
          toolCallHistory,
          usage: totalUsage,
        };
      }
      // 还没决策 → 用 user 消息报错让 LLM 重试
      messages.push({ role: 'assistant', content: content || '' });
      if (reasoningContent) {
        messages[messages.length - 1].reasoning_content = reasoningContent;
      }
      messages.push({
        role: 'user',
        content: '[系统消息] 你还没有做出最终决策。请调用 reply(content) 回复，或 silent() 选择沉默。这是本轮必须的最后一步。',
      });
      continue;  // 再来一轮
    }

    const decisionCalls = toolCalls.filter(call => DECISION_TOOL_NAMES.has(call.name));
    const nonDecisionCalls = toolCalls.filter(call => !DECISION_TOOL_NAMES.has(call.name));

    if (phase === 'gather' && decisionCalls.length > 0 && nonDecisionCalls.length > 0) {
      const iterationToolHistoryStart = toolCallHistory.length;
      for (const call of nonDecisionCalls) {
        const toolResult = await executeTool(call, mcpClient, builtinTools);
        const resultStr = toolResult.content.map(c => c.text || '').join('\n');

        toolCallHistory.push({
          name: call.name,
          args: call.arguments,
          result: resultStr,
        });

        if (onToolCall) {
          onToolCall(call.name, call.arguments, resultStr);
        }
      }

      messages.push(createAssistantToolCallMessage(nonDecisionCalls, reasoningContent, content));
      for (let i = 0; i < nonDecisionCalls.length; i++) {
        const call = nonDecisionCalls[i];
        const entry = toolCallHistory[iterationToolHistoryStart + i];
        messages.push(formatToolCallResultMessage(call.id, entry?.result || '[Error]'));
      }
      messages.push({
        role: 'user',
        content: '[系统消息] 你刚才在同一轮里同时调用了读取工具和最终决策工具。读取结果已返回。现在进入最终决策阶段：下一轮只能调用 reply(content) 或 silent()。',
      });
      phase = 'decide';
      continue;
    }

    if (phase === 'gather' && decisionCalls.length > 0 && nonDecisionCalls.length === 0) {
      messages.push({
        role: 'user',
        content: '[系统消息] 你过早提交了最终决策。现在进入最终决策阶段，请重新只调用一次 reply(content) 或 silent()，并直接回应当前待处理消息本身。',
      });
      phase = 'decide';
      continue;
    }

    if (phase === 'decide' && nonDecisionCalls.length > 0) {
      messages.push(createAssistantToolCallMessage(toolCalls, reasoningContent, content));
      messages.push({
        role: 'user',
        content: '[系统消息] 现在是最终决策阶段，不能再读取文件。请只调用 reply(content) 或 silent()。',
      });
      continue;
    }

    if (phase === 'decide' && decisionCalls.length !== 1) {
      messages.push(createAssistantToolCallMessage(toolCalls, reasoningContent, content));
      messages.push({
        role: 'user',
        content: '[系统消息] 最终决策阶段必须且只能调用一次 reply(content) 或 silent()。请重试。',
      });
      continue;
    }

    const iterationToolHistoryStart = toolCallHistory.length;

    // 执行工具调用
    for (const call of toolCalls) {
      const toolResult = await executeTool(call, mcpClient, builtinTools);
      const resultStr = toolResult.content.map(c => c.text || '').join('\n');

      toolCallHistory.push({
        name: call.name,
        args: call.arguments,
        result: resultStr,
      });

      if (onToolCall) {
        onToolCall(call.name, call.arguments, resultStr);
      }

      // 检查 stopAfterTool
      if (stopAfterTool) {
        const shouldStop = typeof stopAfterTool === 'function'
          ? stopAfterTool(call.name, resultStr)
          : call.name === stopAfterTool;
        if (shouldStop) {
          // 仍然需要把 tool_calls + 结果追加到消息
          messages.push(createAssistantToolCallMessage(toolCalls, reasoningContent, content));
          messages.push(formatToolResultMessage(call.id, resultStr));
          return {
            content: content || '',
            reasoningContent,
            toolCallHistory,
            usage: totalUsage,
          };
        }
      }
    }

    // 追加 assistant 消息（含 tool_calls）
    messages.push(createAssistantToolCallMessage(toolCalls, reasoningContent, content));

    // 追加 tool 结果消息
    for (let i = 0; i < toolCalls.length; i++) {
      const call = toolCalls[i];
      const entry = toolCallHistory[iterationToolHistoryStart + i];
      messages.push(formatToolCallResultMessage(call.id, entry?.result || '[Error]'));
    }

    if (phase === 'decide' && decisionCalls.length === 1) {
      const decisionEntry = toolCallHistory[toolCallHistory.length - 1];
      if (!isSuccessfulDecisionResult(decisionEntry?.result)) {
        messages.push({
          role: 'user',
          content: `[系统消息] 你刚才的最终决策无效：${String(decisionEntry?.result ?? '[Error]')}。请不要泛化寒暄，不要继续读取文件，直接回应本轮当前待处理消息本身，然后只调用一次 reply(content) 或 silent()。`,
        });
      }
    }
  }

  // 超过最大迭代次数
  return {
    content: '[达到最大工具迭代次数]',
    toolCallHistory,
    usage: totalUsage,
  };
}

async function executeTool(
  call: ToolCall,
  mcpClient?: McpClient,
  builtinTools?: Map<string, (args: Record<string, unknown>) => Promise<string>>
): Promise<ToolResult> {
  // 尝试内置工具
  if (builtinTools?.has(call.name)) {
    const handler = builtinTools.get(call.name)!;
    try {
      const result = await handler(call.arguments);
      return { content: [{ type: 'text', text: result }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err}` }], isError: true };
    }
  }

  // 尝试 MCP 工具
  if (mcpClient) {
    try {
      return await mcpClient.callTool(call.name, call.arguments);
    } catch (err) {
      return { content: [{ type: 'text', text: `MCP Error: ${err}` }], isError: true };
    }
  }

  return { content: [{ type: 'text', text: `Unknown tool: ${call.name}` }], isError: true };
}

function formatToolCallResultMessage(toolCallId: string, content: string): Message {
  return {
    role: 'tool',
    tool_call_id: toolCallId,
    content,
  };
}
