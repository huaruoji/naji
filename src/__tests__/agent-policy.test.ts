import { afterEach, describe, it, expect, vi } from 'vitest';

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
    webSearch: {
      enabled: true,
      baseUrl: 'http://127.0.0.1:8080',
      timeoutMs: 1000,
      maxResults: 3,
    },
  };
}

describe('SocialAgent reply policy', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

  it('removes silent tool in must_reply scenarios', () => {
    const agent = new SocialAgent(createConfig()) as any;
    const tools = agent.buildBuiltinTools(
      '2532452182',
      'private',
      ['123'],
      { kind: 'must_reply', reason: '这是私聊消息' },
    ) as Map<string, (args: Record<string, unknown>) => Promise<string>>;

    expect(tools.has('silent')).toBe(false);
  });

  it('rejects stale reply_to outside the current buffer', async () => {
    const agent = new SocialAgent(createConfig()) as any;
    const tools = agent.buildBuiltinTools(
      '699242647',
      'group',
      ['123'],
      { kind: 'may_silent', reason: '普通群聊场景，可由模型判断是否回复' },
    ) as Map<string, (args: Record<string, unknown>) => Promise<string>>;

    await expect(tools.get('reply')!({ content: '收到', reply_to: '999' })).resolves.toContain('reply_to 无效');
  });

  it('formats local web search results for the model', async () => {
    const agent = new SocialAgent(createConfig()) as any;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            title: 'SearXNG',
            url: 'https://docs.searxng.org/',
            content: 'Privacy-respecting metasearch engine documentation.',
            engine: 'wikipedia',
          },
        ],
      }),
    }));

    const tools = agent.buildBuiltinTools(
      '699242647',
      'group',
      ['123'],
      { kind: 'may_silent', reason: '普通群聊场景，可由模型判断是否回复' },
    ) as Map<string, (args: Record<string, unknown>) => Promise<string>>;

    const result = await tools.get('web_search')!({ query: 'searxng', num_results: 2 });
    expect(result).toContain('1. SearXNG [wikipedia]');
    expect(result).toContain('URL: https://docs.searxng.org/');
    expect(result).toContain('摘要: Privacy-respecting metasearch engine documentation.');
  });

  it('falls back to local fetch when Jina Reader fails', async () => {
    const agent = new SocialAgent(createConfig()) as any;
    let callCount = 0;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
      callCount++;
      if (url.startsWith('https://r.jina.ai/')) {
        return { ok: false };
      }
      return {
        ok: true,
        text: async () => '<html><body><p>Hello from local fallback</p></body></html>',
      };
    }));

    const tools = agent.buildBuiltinTools(
      '699242647', 'group', ['123'],
      { kind: 'may_silent', reason: 'test' },
    ) as Map<string, (args: Record<string, unknown>) => Promise<string>>;

    const result = await tools.get('web_fetch')!({ url: 'https://example.com' });
    expect(result).toContain('Hello from local fallback');
    expect(callCount).toBeGreaterThanOrEqual(2);
  });
});
