import { describe, it, expect } from 'vitest';

import { SocialAgent } from '../agent.js';
import { ConversationManager } from '../conversation.js';
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

describe('SocialAgent reply policy', () => {
  it('marks private messages as must_reply', () => {
    const agent = new SocialAgent(createConfig()) as any;
    const conv = new ConversationManager('system');

    const policy = agent.classifyReplyPolicy(
      'private',
      [{ role: 'user', content: '讲个笑话' }],
      true,
      conv,
    );

    expect(policy).toEqual({ kind: 'must_reply', reason: '这是私聊消息' });
  });

  it('marks @ mentions as must_reply in group chat', () => {
    const agent = new SocialAgent(createConfig()) as any;
    const conv = new ConversationManager('system');

    const policy = agent.classifyReplyPolicy(
      'group',
      [{ role: 'user', content: '[@了你] 你觉得呢' }],
      true,
      conv,
    );

    expect(policy).toEqual({ kind: 'must_reply', reason: '有人 @ 了你' });
  });

  it('marks follow-up questions after assistant message as must_reply', () => {
    const agent = new SocialAgent(createConfig()) as any;
    const conv = new ConversationManager('system');
    conv.append({ role: 'assistant', content: '扩散模型确实挺烧脑喵' });

    const policy = agent.classifyReplyPolicy(
      'group',
      [{ role: 'user', content: '你觉得为什么这么难？' }],
      false,
      conv,
    );

    expect(policy).toEqual({ kind: 'must_reply', reason: '对方在紧接着你的发言继续追问' });
  });

  it('allows silence for ordinary group chatter', () => {
    const agent = new SocialAgent(createConfig()) as any;
    const conv = new ConversationManager('system');

    const policy = agent.classifyReplyPolicy(
      'group',
      [{ role: 'user', content: '似了喵喵' }],
      false,
      conv,
    );

    expect(policy).toEqual({ kind: 'may_silent', reason: '普通群聊场景，可由模型判断是否回复' });
  });

  it('rejects silent in must_reply scenarios', async () => {
    const agent = new SocialAgent(createConfig()) as any;
    const tools = agent.buildBuiltinTools(
      '2532452182',
      'private',
      ['123'],
      { kind: 'must_reply', reason: '这是私聊消息' },
    ) as Map<string, (args: Record<string, unknown>) => Promise<string>>;

    await expect(tools.get('silent')!({})).resolves.toContain('当前场景必须回复');
  });
});
