import { describe, it, expect, vi } from 'vitest';
import { ConversationManager } from '../conversation.js';

describe('ConversationManager', () => {
  const systemPrompt = `# Agent: Test

## Personality
You are a test agent.

## Rules
- Rule 1
- Rule 2`;

  it('should initialize with system prompt', () => {
    const cm = new ConversationManager(systemPrompt);
    const messages = cm.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toBe(systemPrompt);
  });

  it('should append messages and track count', () => {
    const cm = new ConversationManager(systemPrompt, { maxTokens: 1000 });
    const initialTokens = cm.tokenCount;

    cm.append({ role: 'user', content: 'Hello' });
    expect(cm.messageCount).toBe(1);
    expect(cm.tokenCount).toBeGreaterThan(initialTokens);

    cm.append({ role: 'assistant', content: 'Hi there!' });
    expect(cm.messageCount).toBe(2);
    expect(cm.tokenCount).toBeGreaterThan(initialTokens);
  });

  it('should batch append messages', () => {
    const cm = new ConversationManager(systemPrompt);
    cm.appendMany([
      { role: 'user', content: 'Message 1' },
      { role: 'user', content: 'Message 2' },
      { role: 'assistant', content: 'Response' },
    ]);
    expect(cm.messageCount).toBe(3);
    expect(cm.getMessages()).toHaveLength(4); // + system prompt
  });

  it('should return recent messages', () => {
    const cm = new ConversationManager(systemPrompt);
    cm.appendMany([
      { role: 'user', content: 'A' },
      { role: 'assistant', content: 'B' },
      { role: 'user', content: 'C' },
      { role: 'assistant', content: 'D' },
    ]);
    const recent = cm.getRecentMessages(2);
    expect(recent).toHaveLength(2);
    expect(recent[0].content).toBe('C');
    expect(recent[1].content).toBe('D');
  });

  it('should detect when reset is needed', () => {
    const cm = new ConversationManager(systemPrompt, { maxTokens: 100 });
    expect(cm.needsReset).toBe(false);
    // Add messages until over 85% threshold
    while (!cm.needsReset) {
      cm.append({
        role: 'user',
        content: 'A long message that will eventually fill up the context window '.repeat(20),
      });
    }
    expect(cm.needsReset).toBe(true);
  });

  it('should estimate tokens correctly', () => {
    const cm = new ConversationManager(systemPrompt);
    const before = cm.tokenCount;

    cm.append({ role: 'user', content: 'Hello' }); // 5 chars ≈ 2 tokens
    expect(cm.tokenCount).toBe(before + 6); // 2 content + 4 overhead

    cm.append({ role: 'assistant', content: 'A'.repeat(40) }); // 40 chars ≈ 10 tokens
    expect(cm.tokenCount).toBe(before + 6 + 14); // 10 content + 4 overhead
  });

  it('should handle tool call messages', () => {
    const cm = new ConversationManager(systemPrompt);
    cm.append({
      role: 'assistant',
      content: null,
      tool_calls: [
        { id: 'call_1', name: 'send_message', arguments: { content: 'hello' } },
      ],
      reasoning_content: 'thinking...',
    });
    expect(cm.messageCount).toBe(1);
    expect(cm.tokenCount).toBeGreaterThan(0);
  });

  it('should reset and call onReset callback', async () => {
    const onReset = vi.fn();
    const cm = new ConversationManager(systemPrompt, {
      maxTokens: 100000,
      onReset,
    });

    cm.append({ role: 'user', content: 'Test message' });
    cm.append({ role: 'assistant', content: 'Test response' });

    const oldMessages = await cm.reset();
    expect(oldMessages).toHaveLength(2);
    expect(cm.resetCount).toBe(1);
    // after reset with onReset, should have summary message
    expect(cm.messageCount).toBeGreaterThanOrEqual(1);
  });

  it('should replace last assistant message', () => {
    const cm = new ConversationManager(systemPrompt);
    cm.append({ role: 'user', content: 'Hi' });
    cm.append({ role: 'assistant', content: 'Old' });

    const result = cm.replaceLastAssistant({ role: 'assistant', content: 'Updated' });
    expect(result).toBe(true);

    const lastMsg = cm.getRecentMessages(1)[0];
    expect(lastMsg.content).toBe('Updated');
  });

  it('should handle empty conversation gracefully', () => {
    const cm = new ConversationManager(systemPrompt);
    expect(cm.messageCount).toBe(0);
    expect(cm.needsReset).toBe(false);
    expect(cm.getRecentMessages(10)).toHaveLength(0);
  });
});
