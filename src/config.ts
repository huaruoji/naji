import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { AgentConfig, LlmConfig } from './types.js';

const DEFAULT_CONFIG_PATH = 'config.json';

export function defaultConfig(socialDir: string): AgentConfig {
  return {
    agentFile: path.join(socialDir, '..', 'agent.md'),
    llm: resolveLlmFromEnv(),
    socialDir,
    pollIntervalMs: Number(process.env.POLL_INTERVAL_MS) || 2000,
    maxContextTokens: Number(process.env.MAX_CONTEXT_TOKENS) || 64000,
    watchedGroups: (process.env.WATCHED_GROUPS || '').split(',').filter(Boolean),
    watchedFriends: (process.env.WATCHED_FRIENDS || '').split(',').filter(Boolean),
    explicitPromptCache: true,
    ownerQQ: process.env.OWNER_QQ || '',
    webSearch: {
      enabled: process.env.WEB_SEARCH_ENABLED === '1',
      baseUrl: process.env.WEB_SEARCH_BASE_URL || 'http://127.0.0.1:8080',
      timeoutMs: Number(process.env.WEB_SEARCH_TIMEOUT_MS) || 10000,
      maxResults: Number(process.env.WEB_SEARCH_MAX_RESULTS) || 5,
    },
  };
}

/** 根据模型名估算合适的上下文限制 */
function resolveContextLimit(model: string): number {
  return 20000; // 小窗口频繁 reset → 系统 prompt 始终缓存 + 每次加载最新状态
}

function resolveLlmFromEnv(): AgentConfig['llm'] {
  return {
    apiKey: process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || '',
    baseUrl: process.env.LLM_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    model: process.env.LLM_MODEL || 'gpt-4o',
    apiFormat: 'openai_compatible',
  };
}

export async function loadConfig(socialDir: string): Promise<AgentConfig> {
  const cfgPath = path.resolve(socialDir, DEFAULT_CONFIG_PATH);
  try {
    const raw = await readFile(cfgPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return { ...defaultConfig(socialDir), ...parsed, socialDir };
  } catch {
    return defaultConfig(socialDir);
  }
}

export async function saveConfig(config: AgentConfig): Promise<void> {
  const cfgPath = path.resolve(config.socialDir, DEFAULT_CONFIG_PATH);
  await mkdir(path.dirname(cfgPath), { recursive: true });
  const { socialDir, ...toSave } = config;
  await writeFile(cfgPath, JSON.stringify(toSave, null, 2), 'utf-8');
}

export function resolveLlmConfig(config: AgentConfig): LlmConfig {
  return {
    apiKey: config.llm.apiKey || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || '',
    baseUrl: config.llm.baseUrl || process.env.LLM_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    model: config.llm.model || process.env.LLM_MODEL || 'gpt-4o',
    apiFormat: config.llm.apiFormat || 'openai_compatible',
  };
}
