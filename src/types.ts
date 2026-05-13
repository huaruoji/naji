import type { McpServerTransport } from './mcp/client.js';

// ============ Core Types ============

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentPart[] | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
  reasoning_content?: string;
}

export interface ContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  serverName?: string; // for MCP tools: serverName__toolName
}

// ============ LLM Types ============

export type ApiFormat = 'openai_compatible' | 'gemini_official' | 'anthropic_native';

export interface LlmConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  apiFormat: ApiFormat;
}

export interface LlmResponse {
  content: string;
  reasoningContent?: string;
  toolCalls?: ToolCall[];
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cachedTokens?: number;
  };
}

export interface StreamChunk {
  delta: string;
  reasoningDelta?: string;
  done: boolean;
}

// ============ Agent Types ============

export interface AgentConfig {
  /** Path to agent.md */
  agentFile: string;
  /** LLM for the agent */
  llm: LlmConfig;
  /** MCP server config */
  mcp?: McpServerConfig;
  /** Social workspace directory */
  socialDir: string;
  /** Poll interval in ms */
  pollIntervalMs: number;
  /** Max tokens before triggering reset */
  maxContextTokens: number;
  /** Targets to watch */
  watchedGroups: string[];
  watchedFriends: string[];
  /** Prompt cache toggle */
  explicitPromptCache: boolean;
  /** 主人的 QQ 号（用于安全令牌识别） */
  ownerQQ?: string;
}

export interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  transport?: McpServerTransport;
  url?: string;
}

export interface SocialState {
  /** Path to current INTENT state within social dir */
  intentFile: string;
  /** Path to reply brief within social dir */
  replyBriefFile: string;
  /** Path to notes */
  notesFile: string;
  /** Known groups map */
  targets: Set<string>;
  /** Target name cache */
  targetNames: Map<string, string>;
}

// ============ Tool Types ============

export interface ToolResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

export interface ToolExecutionContext {
  petId: string;
  targetId: string;
  targetType: 'group' | 'private';
  mcpServerName: string;
  socialDir: string;
}

// ============ Exported from adapters ============

export interface AdapterCapabilities {
  supportsImage: boolean;
  supportsVideo: boolean;
  supportsAudio: boolean;
  supportsPdf: boolean;
}
