import { describe, it, expect } from 'vitest';
import { getApiEndpoint } from '../llm/index.js';
import {
  buildOpenAIRequest,
  parseResponse,
  parseStreamChunk,
  buildHeaders,
  createAssistantToolCallMessage,
  formatToolResultMessage,
} from '../llm/openaiAdapter.js';
import type { Message, LlmConfig, ToolCall } from '../types.js';

describe('LLM - getApiEndpoint', () => {
  it('should handle default URL', () => {
    const config: LlmConfig = { apiKey: 'test', baseUrl: '', model: 'gpt-4', apiFormat: 'openai_compatible' };
    const endpoint = getApiEndpoint(config);
    expect(endpoint).toBe('https://api.openai.com/v1/chat/completions');
  });

  it('should add /v1 if missing', () => {
    const config: LlmConfig = { apiKey: 'test', baseUrl: 'https://custom.api.com', model: 'gpt-4', apiFormat: 'openai_compatible' };
    const endpoint = getApiEndpoint(config);
    expect(endpoint).toBe('https://custom.api.com/v1/chat/completions');
  });

  it('should handle URL with trailing slash', () => {
    const config: LlmConfig = { apiKey: 'test', baseUrl: 'https://custom.api.com/', model: 'gpt-4', apiFormat: 'openai_compatible' };
    const endpoint = getApiEndpoint(config);
    expect(endpoint).toBe('https://custom.api.com/v1/chat/completions');
  });

  it('should preserve /v1 in path', () => {
    const config: LlmConfig = { apiKey: 'test', baseUrl: 'https://opencode.ai/zen/go/v1', model: 'deepseek', apiFormat: 'openai_compatible' };
    const endpoint = getApiEndpoint(config);
    expect(endpoint).toBe('https://opencode.ai/zen/go/v1/chat/completions');
  });
});

describe('LLM - buildOpenAIRequest', () => {
  it('should build basic request', () => {
    const messages: Message[] = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hi' },
    ];
    const req = buildOpenAIRequest(messages, 'gpt-4');
    expect(req.model).toBe('gpt-4');
    expect(req.messages).toHaveLength(2);
    expect(req.stream).toBe(false);
  });

  it('should include tools when provided', () => {
    const messages: Message[] = [{ role: 'user', content: 'Hi' }];
    const tools = [{ name: 'test_tool', description: 'A test tool', inputSchema: {} }];
    const req = buildOpenAIRequest(messages, 'gpt-4', tools);
    expect(req.tools).toHaveLength(1);
    expect(req.tool_choice).toBe('auto');
  });

  it('should preserve reasoning_content in assistant messages', () => {
    const messages: Message[] = [
      { role: 'user', content: 'Think step by step' },
      {
        role: 'assistant',
        content: 'Final answer',
        tool_calls: [{ id: 'call_1', name: 'search', arguments: { q: 'test' } }],
        reasoning_content: 'I need to search for this...',
      },
    ];
    const req = buildOpenAIRequest(messages, 'gpt-4') as Record<string, unknown>;
    const msgs = req.messages as Array<Record<string, unknown>>;
    expect((msgs[1] as Record<string, unknown>).reasoning_content).toBe('I need to search for this...');
  });
});

describe('LLM - parseResponse', () => {
  it('should parse text response', () => {
    const data = {
      choices: [{ message: { content: 'Hello!' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    };
    const result = parseResponse(data);
    expect(result.content).toBe('Hello!');
    expect(result.usage?.inputTokens).toBe(10);
  });

  it('should parse tool calls', () => {
    const data = {
      choices: [{
        message: {
          content: null,
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: { name: 'search', arguments: '{"q":"test"}' },
          }],
        },
      }],
    };
    const result = parseResponse(data);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].name).toBe('search');
    expect(result.toolCalls![0].arguments).toEqual({ q: 'test' });
  });

  it('should parse reasoning_content', () => {
    const data = {
      choices: [{
        message: {
          content: 'Answer',
          reasoning_content: 'Deep thought process...',
        },
      }],
    };
    const result = parseResponse(data);
    expect(result.reasoningContent).toBe('Deep thought process...');
  });
});

describe('LLM - parseStreamChunk', () => {
  it('should parse text delta', () => {
    const chunk = JSON.stringify({ choices: [{ delta: { content: 'Hello' } }] });
    const result = parseStreamChunk(chunk);
    expect(result.deltaText).toBe('Hello');
    expect(result.done).toBe(false);
  });

  it('should detect completion', () => {
    const chunk = JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] });
    const result = parseStreamChunk(chunk);
    expect(result.done).toBe(true);
  });

  it('should handle [DONE]', () => {
    const result = parseStreamChunk('[DONE]');
    expect(result.done).toBe(true);
  });

  it('should parse reasoning delta', () => {
    const chunk = JSON.stringify({
      choices: [{ delta: { content: '', reasoning_content: 'thinking...' } }],
    });
    const result = parseStreamChunk(chunk);
    expect(result.reasoningDelta).toBe('thinking...');
  });
});

describe('LLM - createAssistantToolCallMessage', () => {
  it('should create assistant message with tool calls', () => {
    const toolCalls: ToolCall[] = [
      { id: 'call_1', name: 'search', arguments: { q: 'test' } },
    ];
    const msg = createAssistantToolCallMessage(toolCalls);
    expect(msg.role).toBe('assistant');
    expect(msg.tool_calls).toHaveLength(1);
    expect(msg.tool_calls![0].name).toBe('search');
  });

  it('should include reasoning_content', () => {
    const msg = createAssistantToolCallMessage(
      [{ id: 'c1', name: 'test', arguments: {} }],
      'reasoning',
      null
    );
    expect(msg.reasoning_content).toBe('reasoning');
  });
});

describe('LLM - formatToolResultMessage', () => {
  it('should create tool result message', () => {
    const msg = formatToolResultMessage('call_1', 'result data');
    expect(msg.role).toBe('tool');
    expect(msg.tool_call_id).toBe('call_1');
    expect(msg.content).toBe('result data');
  });
});

describe('LLM - buildHeaders', () => {
  it('should build auth headers', () => {
    const headers = buildHeaders('sk-test-key');
    expect(headers.Authorization).toBe('Bearer sk-test-key');
    expect(headers['Content-Type']).toBe('application/json');
  });
});
