/**
 * Conversation Manager — 追加式对话管理器
 *
 * 核心设计：
 * - system prompt 永远不变（agent.md + 工具定义），最大化 prompt prefix 缓存
 * - 新消息只追加到末尾，不重建整个对话
 * - 当接近上下文限制时，触发 reset（总结 + 重建）
 */
import type { Message, LlmConfig } from './types.js';

/** 简单 token 估算（4 chars ≈ 1 token） */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function estimateMessageTokens(msg: Message): number {
  let total = 4; // overhead per message
  if (typeof msg.content === 'string') {
    total += estimateTokens(msg.content);
  } else if (Array.isArray(msg.content)) {
    for (const part of msg.content) {
      total += estimateTokens(part.text || '');
      if (part.type === 'image_url') total += 100; // image ~100 tokens
    }
  }
  if (msg.tool_calls) {
    for (const tc of msg.tool_calls) {
      total += estimateTokens(tc.name + JSON.stringify(tc.arguments));
    }
  }
  if (msg.tool_call_id) total += 4;
  if (msg.reasoning_content) total += estimateTokens(msg.reasoning_content);
  return total;
}

export interface ConversationState {
  /** 系统 prompt — 永远不变 */
  systemPrompt: string;
  /** 累积的对话消息（不含 system prompt） */
  messages: Message[];
  /** 已估算的 token 数 */
  tokenCount: number;
  /** 上下文上限 */
  maxTokens: number;
  /** reset 次数统计 */
  resetCount: number;
}

export class ConversationManager {
  private state: ConversationState;
  private onReset?: (summary: string) => Promise<void>;

  constructor(
    systemPrompt: string,
    options?: { maxTokens?: number; onReset?: (summary: string) => Promise<void> }
  ) {
    this.state = {
      systemPrompt,
      messages: [],
      tokenCount: estimateTokens(systemPrompt),
      maxTokens: options?.maxTokens ?? 64000,
      resetCount: 0,
    };
    this.onReset = options?.onReset;
  }

  /** 获取当前所有消息（含 system prompt） */
  getMessages(): Message[] {
    return [{ role: 'system', content: this.state.systemPrompt }, ...this.state.messages];
  }

  /** 获取最近的 N 条消息 */
  getRecentMessages(n: number): Message[] {
    return this.state.messages.slice(-n);
  }

  /** 追加消息 */
  append(msg: Message): void {
    this.state.messages.push(msg);
    this.state.tokenCount += estimateMessageTokens(msg);
  }

  /** 批量追加 */
  appendMany(msgs: Message[]): void {
    for (const msg of msgs) {
      this.state.messages.push(msg);
      this.state.tokenCount += estimateMessageTokens(msg);
    }
  }

  /** 当前 token 数 */
  get tokenCount(): number {
    return this.state.tokenCount;
  }

  /** 当前消息数 */
  get messageCount(): number {
    return this.state.messages.length;
  }

  /** 重置次数 */
  get resetCount(): number {
    return this.state.resetCount;
  }

  /** 是否需要 reset */
  get needsReset(): boolean {
    return this.state.tokenCount > this.state.maxTokens * 0.85;
  }

  /**
   * 重置对话：生成摘要 → 清空 → 重建上下文
   * 返回旧消息用于外部做总结
   */
  async reset(): Promise<Message[]> {
    const oldMessages = [...this.state.messages];
    const systemPrompt = this.state.systemPrompt;

    // 生成摘要（由外部调用者提供）
    if (this.onReset && oldMessages.length > 0) {
      const summary = await this.buildSummary(oldMessages);
      await this.onReset(summary);

      // 重建对话：system prompt + 摘要作为上下文
      this.state.messages = [
        {
          role: 'user',
          content: `[上下文重置 — 以下是之前的对话摘要]\n\n${summary}\n\n继续当前对话。使用 social_read 获取最新的状态文件。`,
        },
      ];
    } else {
      this.state.messages = [];
    }

    this.state.tokenCount = estimateTokens(systemPrompt) + this.state.messages.reduce(
      (sum, m) => sum + estimateMessageTokens(m), 0
    );
    this.state.resetCount++;
    return oldMessages;
  }

  /** 生成摘要（简单的消息压缩） */
  private async buildSummary(messages: Message[]): Promise<string> {
    const recent = messages.slice(-20); // 只总结最近 20 条
    const parts: string[] = [];

    for (const msg of recent) {
      const content =
        typeof msg.content === 'string'
          ? msg.content.slice(0, 200)
          : '[多模态内容]';
      if (msg.role === 'user') {
        parts.push(`用户: ${content}`);
      } else if (msg.role === 'assistant') {
        const tc = msg.tool_calls ? ` [调用了 ${msg.tool_calls.map(t => t.name).join(', ')}]` : '';
        parts.push(`助手: ${content}${tc}`);
      } else if (msg.role === 'tool') {
        const preview = content.slice(0, 100);
        parts.push(`工具结果(${msg.name || '?'}): ${preview}`);
      }
    }

    return `最近的 ${messages.length} 条消息摘要:\n${parts.slice(-20).join('\n')}`;
  }

  /** 替换最后一条 assistant 消息（用于工具循环中更新） */
  replaceLastAssistant(msg: Message): boolean {
    for (let i = this.state.messages.length - 1; i >= 0; i--) {
      if (this.state.messages[i].role === 'assistant') {
        this.state.tokenCount -= estimateMessageTokens(this.state.messages[i]);
        this.state.messages[i] = msg;
        this.state.tokenCount += estimateMessageTokens(msg);
        return true;
      }
    }
    return false;
  }
}
