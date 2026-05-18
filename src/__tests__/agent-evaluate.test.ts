import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../mcp/toolExecutor.js', () => ({
  executeWithTools: vi.fn(),
}));

import { SocialAgent } from '../agent.js';
import { executeWithTools } from '../mcp/toolExecutor.js';
import type { AgentConfig } from '../types.js';

function createConfig(): AgentConfig {
  return {
    agentFile: '/tmp/agent.md',
    llm: {
      apiKey: 'test',
      baseUrl: 'https://example.com/v1',
      model: 'test-model',
      apiFormat: 'openai_compatible',
    },
    socialDir: '/tmp/social',
    pollIntervalMs: 5000,
    maxContextTokens: 64000,
    watchedGroups: ['699242647'],
    watchedFriends: ['2532452182'],
    explicitPromptCache: true,
    ownerQQ: '2532452182',
  };
}

function createAgent() {
  const agent = new SocialAgent(createConfig()) as any;
  agent.systemPrompt = 'system';
  agent.llmConfig = createConfig().llm;
  agent.workspace = {
    append: vi.fn(),
    read: vi.fn(),
  };
  agent.logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  return agent;
}

describe('SocialAgent evaluate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps buffered messages when no successful decision is made', async () => {
    const agent = createAgent();
    const mockedExecuteWithTools = vi.mocked(executeWithTools);
    mockedExecuteWithTools.mockResolvedValue({
      content: '',
      toolCallHistory: [],
      usage: { inputTokens: 10, outputTokens: 5, cachedTokens: 0 },
    });

    const bufferedMessage = { role: 'user', content: '[#123] [05-15 15:29] «name»user(1)«/name» ‹看看β›‹/msg›' };
    agent.messageBuffer.set('699242647', [bufferedMessage]);

    await agent.evaluate('699242647', 'group');

    expect(agent.messageBuffer.get('699242647')).toEqual([bufferedMessage]);
    expect(agent.getConversation('699242647').getRecentMessages(10)).toEqual([]);
  });

  it('persists successful decisions without leaking wrapped message ids into history', async () => {
    const agent = createAgent();
    const mockedExecuteWithTools = vi.mocked(executeWithTools);
    mockedExecuteWithTools.mockResolvedValue({
      content: '',
      toolCallHistory: [
        { name: 'reply', args: { content: '看看啥', reply_to: '123' }, result: '[OK] 消息已发送' },
      ],
      usage: { inputTokens: 10, outputTokens: 5, cachedTokens: 0 },
    });

    const bufferedMessage = { role: 'user', content: '[#123] [05-15 15:29] «name»user(1)«/name» ‹看看β›‹/msg›' };
    agent.messageBuffer.set('699242647', [bufferedMessage]);

    await agent.evaluate('699242647', 'group');

    expect(agent.messageBuffer.get('699242647')).toEqual([]);
    const recent = agent.getConversation('699242647').getRecentMessages(2);
    expect(recent).toHaveLength(2);
    expect(recent[0].content).not.toContain('[#123]');
    expect(recent[0].content).toContain('看看β');
    expect(recent[1]).toEqual({ role: 'assistant', content: '看看啥' });
  });
});
