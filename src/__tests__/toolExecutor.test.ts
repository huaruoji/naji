import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../llm/index.js', () => ({
  callLLM: vi.fn(),
}));

import { callLLM } from '../llm/index.js';
import { executeWithTools } from '../mcp/toolExecutor.js';
import type { LlmConfig, Message } from '../types.js';

describe('toolExecutor', () => {
  const llmConfig: LlmConfig = {
    apiKey: 'test',
    baseUrl: 'https://example.com/v1',
    model: 'test-model',
    apiFormat: 'openai_compatible',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('re-asks the model when it mixes reads with a final silent decision', async () => {
    const mockedCallLLM = vi.mocked(callLLM);
    mockedCallLLM
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [
          { id: 'call_read', name: 'social_read', arguments: { path: 'people/2716599708.md' } },
          { id: 'call_silent', name: 'silent', arguments: {} },
        ],
        usage: { inputTokens: 10, outputTokens: 5, cachedTokens: 0 },
      })
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [
          { id: 'call_reply', name: 'reply', arguments: { content: '他是 FPGA 工程师喵', reply_to: '123' } },
        ],
        usage: { inputTokens: 12, outputTokens: 6, cachedTokens: 0 },
      });

    const messages: Message[] = [{ role: 'user', content: '你对2716599708的记忆是什么？' }];
    const builtinTools = new Map<string, (args: Record<string, unknown>) => Promise<string>>();
    builtinTools.set('social_read', async args => `profile:${String(args.path)}`);
    builtinTools.set('reply', async () => '[OK] 消息已发送');
    builtinTools.set('silent', async () => '[OK] 沉默');

    const result = await executeWithTools({
      llmConfig,
      messages,
      builtinTools,
      maxIterations: 5,
      stopAfterTool: name => name === 'reply' || name === 'silent',
    });

    expect(mockedCallLLM).toHaveBeenCalledTimes(2);
    expect(result.toolCallHistory.map(entry => entry.name)).toEqual(['social_read', 'reply']);

    const secondCallMessages = mockedCallLLM.mock.calls[1][1];
    expect(secondCallMessages.some(msg => typeof msg.content === 'string' && msg.content.includes('读取工具和最终决策工具'))).toBe(true);
  });

  it('switches to decide phase after gather completes without more tool calls', async () => {
    const mockedCallLLM = vi.mocked(callLLM);
    mockedCallLLM
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [
          { id: 'call_read', name: 'social_read', arguments: { path: 'owner.md' } },
        ],
        usage: { inputTokens: 10, outputTokens: 5, cachedTokens: 0 },
      })
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [],
        usage: { inputTokens: 11, outputTokens: 4, cachedTokens: 0 },
      })
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [
          { id: 'call_silent', name: 'silent', arguments: {} },
        ],
        usage: { inputTokens: 12, outputTokens: 3, cachedTokens: 0 },
      });

    const messages: Message[] = [{ role: 'user', content: '最近怎么样？' }];
    const builtinTools = new Map<string, (args: Record<string, unknown>) => Promise<string>>();
    builtinTools.set('social_read', async args => `read:${String(args.path)}`);
    builtinTools.set('reply', async () => '[OK] 消息已发送');
    builtinTools.set('silent', async () => '[OK] 沉默');

    const result = await executeWithTools({
      llmConfig,
      messages,
      builtinTools,
      maxIterations: 5,
      stopAfterTool: name => name === 'reply' || name === 'silent',
    });

    expect(mockedCallLLM).toHaveBeenCalledTimes(3);
    expect(result.toolCallHistory.map(entry => entry.name)).toEqual(['social_read', 'silent']);
    const thirdCallMessages = mockedCallLLM.mock.calls[2][1];
    expect(thirdCallMessages.some(msg => typeof msg.content === 'string' && msg.content.includes('现在进入最终决策阶段'))).toBe(true);
  });

  it('does not accept an early silent decision before the decide phase', async () => {
    const mockedCallLLM = vi.mocked(callLLM);
    mockedCallLLM
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [
          { id: 'call_silent', name: 'silent', arguments: {} },
        ],
        usage: { inputTokens: 8, outputTokens: 3, cachedTokens: 0 },
      })
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [
          { id: 'call_reply', name: 'reply', arguments: { content: '我在喵', reply_to: '1' } },
        ],
        usage: { inputTokens: 9, outputTokens: 4, cachedTokens: 0 },
      });

    const messages: Message[] = [{ role: 'user', content: '@你 怎么不回复' }];
    const builtinTools = new Map<string, (args: Record<string, unknown>) => Promise<string>>();
    builtinTools.set('reply', async () => '[OK] 消息已发送');
    builtinTools.set('silent', async () => '[Error] 当前场景必须回复，不能沉默');

    const result = await executeWithTools({
      llmConfig,
      messages,
      builtinTools,
      maxIterations: 5,
      stopAfterTool: (name, result) => (name === 'reply' || name === 'silent') && result.startsWith('[OK]'),
    });

    expect(mockedCallLLM).toHaveBeenCalledTimes(2);
    expect(result.toolCallHistory.map(entry => [entry.name, entry.result])).toEqual([
      ['reply', '[OK] 消息已发送'],
    ]);
    const secondCallMessages = mockedCallLLM.mock.calls[1][1];
    expect(secondCallMessages.some(msg => typeof msg.content === 'string' && msg.content.includes('现在进入最终决策阶段'))).toBe(true);
  });
});
