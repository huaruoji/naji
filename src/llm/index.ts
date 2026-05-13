/**
 * LLM 调用封装
 * 直接 HTTP 调用（不需要 Rust proxy），支持流式和非流式。
 */
import { buildOpenAIRequest, parseResponse, parseStreamChunk, buildHeaders } from './openaiAdapter.js';
import type { Message, LlmConfig, LlmResponse, ToolDefinition } from '../types.js';

export function getApiEndpoint(llmConfig: LlmConfig): string {
  const base = llmConfig.baseUrl || 'https://api.openai.com/v1';
  const url = !base.includes('/v1')
    ? base.endsWith('/') ? base + 'v1' : base + '/v1'
    : base;
  return `${url}/chat/completions`;
}

/**
 * 非流式调用 LLM
 */
export async function callLLM(
  llmConfig: LlmConfig,
  messages: Message[],
  tools?: ToolDefinition[],
  options?: { temperature?: number; maxTokens?: number }
): Promise<LlmResponse> {
  const endpoint = getApiEndpoint(llmConfig);
  const body = buildOpenAIRequest(messages, llmConfig.model, tools as unknown as Record<string, unknown>[], {
    ...options,
    stream: false,
  });

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: buildHeaders(llmConfig.apiKey),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`API error ${response.status}: ${errorText}`);
  }

  const data = await response.json() as Record<string, unknown>;
  return parseResponse(data);
}

/**
 * 流式调用 LLM，逐块回调
 */
export async function callLLMStream(
  llmConfig: LlmConfig,
  messages: Message[],
  tools: ToolDefinition[],
  onChunk: (text: string, reasoning?: string) => void,
  options?: { temperature?: number; maxTokens?: number }
): Promise<LlmResponse> {
  const endpoint = getApiEndpoint(llmConfig);
  const body = buildOpenAIRequest(messages, llmConfig.model, tools as unknown as Record<string, unknown>[], {
    ...options,
    stream: true,
  });

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: buildHeaders(llmConfig.apiKey),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`API error ${response.status}: ${errorText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';
  let fullReasoning = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const chunk = trimmed.slice(6);

        const parsed = parseStreamChunk(chunk);
        if (parsed.done) break;

        if (parsed.deltaText) {
          fullContent += parsed.deltaText;
          onChunk(parsed.deltaText, parsed.reasoningDelta);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { content: fullContent, reasoningContent: fullReasoning || undefined };
}
