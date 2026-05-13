/**
 * OpenAI 兼容适配器
 * 复用 PetGPT 的 openaiCompatible.js 核心逻辑，移植为 TypeScript
 */
import type { Message, ToolCall, LlmResponse, AdapterCapabilities, ApiFormat, ToolDefinition } from '../types.js';

export const capabilities: AdapterCapabilities = {
  supportsImage: true,
  supportsVideo: false,
  supportsAudio: false,
  supportsPdf: false,
};

// Provider 默认 URL 映射
const PROVIDER_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  anthropic: 'https://api.anthropic.com/v1',
  grok: 'https://api.x.ai/v1',
};

/** 获取完整的 API URL */
function getApiUrl(apiFormat: ApiFormat, baseUrl?: string): string {
  if (baseUrl && baseUrl !== 'default') {
    let url = baseUrl;
    if (!url.endsWith('/v1') && !url.endsWith('/v1/')) {
      url = url.endsWith('/') ? url + 'v1' : url + '/v1';
    }
    return url;
  }
  return PROVIDER_URLS[apiFormat] || PROVIDER_URLS.openai;
}

/** 构建 OpenAI 格式的请求体 */
export function buildOpenAIRequest(
  messages: Message[],
  model: string,
  tools?: Array<Record<string, unknown>>,
  options?: { temperature?: number; maxTokens?: number; stream?: boolean }
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    messages: convertMessages(messages),
    stream: options?.stream ?? false,
  };
  if (options?.temperature !== undefined) body.temperature = options.temperature;
  if (options?.maxTokens !== undefined) body.max_tokens = options.maxTokens;
  if (tools && tools.length > 0) {
    body.tools = tools.map(t => formatToolForOpenAI(t as unknown as ToolDefinition));
    body.tool_choice = 'auto';
  }
  return body;
}

/** 将 ToolDefinition 格式化为 OpenAI API 格式 */
function formatToolForOpenAI(tool: ToolDefinition): Record<string, unknown> {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description || '',
      parameters: tool.inputSchema || { type: 'object', properties: {} },
    },
  };
}


/** 转换消息为 OpenAI API 格式 */
function convertMessages(messages: Message[]): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      result.push({ role: 'system', content: msg.content });
      continue;
    }

    if (msg.role === 'tool') {
      result.push({
        role: 'tool',
        tool_call_id: msg.tool_call_id,
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
      });
      continue;
    }

    if (msg.role === 'assistant') {
      const entry: Record<string, unknown> = { role: 'assistant' };

      // Handle content
      if (typeof msg.content === 'string') {
        entry.content = msg.content;
      } else if (Array.isArray(msg.content)) {
        entry.content = msg.content.map(p => {
          if (p.type === 'image_url') return { type: 'image_url', image_url: p.image_url };
          return { type: 'text', text: p.text || '' };
        });
      } else {
        entry.content = null;
      }

      // Handle tool_calls
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      entry.tool_calls = msg.tool_calls.map(tc => {
        const funcEntry: Record<string, unknown> = {
          name: tc.name,
          arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments),
        };
        return { id: tc.id, type: 'function', function: funcEntry };
      });
    }

      // Preserve reasoning_content (DeepSeek reasoning mode)
      if (msg.reasoning_content) {
        entry.reasoning_content = msg.reasoning_content;
      }

      result.push(entry);
      continue;
    }

    // user role
    if (typeof msg.content === 'string') {
      result.push({ role: 'user', content: msg.content });
    } else if (Array.isArray(msg.content)) {
      const parts = msg.content.map(p => {
        if (p.type === 'image_url') return { type: 'image_url', image_url: p.image_url };
        return { type: 'text', text: p.text || '' };
      });
      result.push({ role: 'user', content: parts });
    }
  }

  return result;
}

/** 解析 OpenAI API 响应 */
export function parseResponse(data: Record<string, unknown>): LlmResponse {
  const choices = data.choices as Array<Record<string, unknown>> | undefined;
  const message = choices?.[0]?.message as Record<string, unknown> | undefined;

  if (!message) {
    return { content: '' };
  }

  const content = (message.content as string) || '';
  const reasoningContent = (message.reasoning_content as string) || (message.reasoning as string) || undefined;

  // 解析工具调用
  let toolCalls: ToolCall[] | undefined;
  const rawToolCalls = message.tool_calls as Array<Record<string, unknown>> | undefined;
  if (rawToolCalls && rawToolCalls.length > 0) {
    toolCalls = rawToolCalls.map(tc => ({
      id: tc.id as string,
      name: (tc.function as Record<string, unknown>).name as string,
      arguments: JSON.parse((tc.function as Record<string, unknown>).arguments as string) as Record<string, unknown>,
    }));
  }

  // 解析 usage
  const rawUsage = data.usage as Record<string, unknown> | undefined;
  const usage = rawUsage
    ? {
        inputTokens: (rawUsage.promptTokens ?? rawUsage.prompt_tokens ?? 0) as number,
        outputTokens: (rawUsage.completionTokens ?? rawUsage.completion_tokens ?? 0) as number,
        cachedTokens: ((rawUsage as Record<string, unknown>).prompt_tokens_details as Record<string, unknown> | undefined)
            ?.cached_tokens as number | undefined,
      }
    : undefined;

  return {
    content,
    reasoningContent,
    toolCalls,
    usage,
  };
}

/** 解析流式响应块 */
export function parseStreamChunk(chunk: string): {
  deltaText: string;
  reasoningDelta?: string;
  done: boolean;
  finishReason?: string;
} {
  if (!chunk || chunk === '[DONE]') {
    return { deltaText: '', done: true };
  }

  try {
    const data = JSON.parse(chunk) as Record<string, unknown>;
    const choice = (data.choices as Array<Record<string, unknown>>)?.[0];
    if (!choice) return { deltaText: '', done: true };

    const delta = choice.delta as Record<string, unknown> | undefined;
    const deltaText = (delta?.content as string) || '';
    const reasoningDelta = (delta?.reasoning_content as string) || undefined;
    const done = choice.finish_reason != null;

    return { deltaText, reasoningDelta, done, finishReason: choice.finish_reason as string | undefined };
  } catch {
    return { deltaText: '', done: false };
  }
}

/** 构建请求头 */
export function buildHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
}

/** 格式化工具结果消息 */
export function formatToolResultMessage(
  toolCallId: string,
  result: string
): Message {
  return {
    role: 'tool',
    tool_call_id: toolCallId,
    content: typeof result === 'string' ? result : JSON.stringify(result),
  };
}

/** 创建带有工具调用的 assistant 消息 */
export function createAssistantToolCallMessage(
  toolCalls: ToolCall[],
  reasoningContent?: string,
  content?: string | null
): Message {
  const msg: Message = {
    role: 'assistant',
    content: content ?? null,
    tool_calls: toolCalls,
  };
  if (reasoningContent) {
    msg.reasoning_content = reasoningContent;
  }
  return msg;
}
