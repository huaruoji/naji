#!/usr/bin/env node

/**
 * agent-cli — Social Agent CLI
 *
 * Usage:
 *   agent-cli start              # Start the social agent
 *   agent-cli init               # Initialize social directory with defaults
 *   agent-cli config             # View current config
 *   agent-cli config-set <k> <v> # Set config value
 *   agent-cli test-llm           # Test LLM connectivity
 *   agent-cli mock               # Start mock MCP server for testing
 */

import { Command } from 'commander';
import path from 'node:path';
import fs from 'node:fs';
import chalk from 'chalk';

import { loadConfig, saveConfig, defaultConfig, resolveLlmConfig } from './config.js';
import { SocialAgent } from './agent.js';
import { startMockMcpServer } from './__tests__/mock-mcp.js';
import { loadEnv } from './env.js';
import { callLLM } from './llm/index.js';
import type { Message } from './types.js';

// 启动时自动加载 .env
loadEnv();

const program = new Command();

program
  .name('agent-cli')
  .description('CLI social agent with append-only prompt caching')
  .version('0.1.0');

// ============ start ============
program
  .command('start')
  .description('Start the social agent')
  .option('-d, --dir <path>', 'Social directory', './social')
  .option('-c, --config <path>', 'Config file path')
  .option('--mock', 'Use mock MCP (for testing)', false)
  .option('--once', 'Run a single eval cycle then exit (for testing)', false)
  .action(async (opts) => {
    const socialDir = path.resolve(opts.dir);
    const config = await loadConfig(socialDir);

    if (opts.mock) {
      console.log(chalk.cyan('🔧 Using mock MCP server'));
      const mockScript = path.resolve(
        typeof import.meta.dirname !== 'undefined'
          ? import.meta.dirname
          : path.dirname(new URL(import.meta.url).pathname),
        '__tests__/mock-mcp.ts'
      );
      config.mcp = {
        command: 'npx',
        args: ['tsx', mockScript],
      };
      // 添加测试群到 watched groups
      if (config.watchedGroups.length === 0) {
        config.watchedGroups.push('699242647');
      }
    }

    const agent = new SocialAgent(config);
    await agent.start();

    if (opts.once) {
      // 单次 poll + eval 后退出
      console.log(chalk.cyan('\n⏳ Single eval mode, polling once...'));
      await agent.pollOnce();
      // 等防抖 + LLM 调用完成
      console.log(chalk.gray('  Waiting for debounce + eval...'));
      await new Promise(r => setTimeout(r, 35000));
      console.log(chalk.gray('\n--once: done, exiting'));
      await agent.stop();
      process.exit(0);
      return;
    }

    // 优雅退出
    const shutdown = async () => {
      console.log(chalk.yellow('\nShutting down...'));
      await agent.stop();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });

// ============ init ============
program
  .command('init')
  .description('Initialize social directory with defaults')
  .option('-d, --dir <path>', 'Social directory', './social')
  .action(async (opts) => {
    const socialDir = path.resolve(opts.dir);
    const config = defaultConfig(socialDir);
    await saveConfig(config);

    // 创建必要目录
    const dirs = ['', 'group', 'friend', 'people', 'context'];
    for (const d of dirs) {
      fs.mkdirSync(path.join(socialDir, d), { recursive: true });
    }

    // 写入默认 agent.md（如果不存在）
    const agentFile = config.agentFile;
    if (!fs.existsSync(agentFile)) {
      const defaultAgent = `# Agent: AI Assistant

## Personality
你是一个友好的 AI 助手，活跃在群聊中。

## Behavioral Rules
- 回复要简短自然
- 别人 @你 时必须回复
- 不知道的事直接说不知道
- 可以调侃，但不要攻击或贬低他人

## Communication Style
- 语气轻松友好
- 根据对话氛围调整语气
`;
      fs.writeFileSync(agentFile, defaultAgent, 'utf-8');
      console.log(chalk.green(`✓ Created ${agentFile}`));
    }

    // 创建示例文件（仅当文件不存在时）
    const exampleFiles: Array<{ path: string; content: string; label: string }> = [
      {
        path: path.join(socialDir, 'owner.md'),
        label: 'owner.md',
        content: `# 主人

## 基本信息
- QQ号：你的QQ号
- 昵称：你的群昵称

## 与你的关系
- 是你的主人
- 在这里填写你对主人的了解
`,
      },
      {
        path: path.join(socialDir, 'CONTACTS.md'),
        label: 'CONTACTS.md',
        content: `# 联系人索引

## 格式：QQ号、昵称、来源群、一句话印象

### 群名（群号）
- 123456789、昵称、群号、一句话印象
`,
      },
      {
        path: path.join(socialDir, 'notes.md'),
        label: 'notes.md',
        content: `# 笔记

在这里记录跨群通用的知识。
`,
      },
      {
        path: path.join(socialDir, 'people/example.md'),
        label: 'people/example.md',
        content: `# 昵称 (QQ号)

## 基本信息
- QQ号：123456789
- 昵称：群昵称
- 来源群：群名 (群号)

## 印象
- 一句话描述

## 兴趣
- 兴趣1
- 兴趣2
`,
      },
      {
        path: path.join(socialDir, 'group/RULE_example.md'),
        label: 'group/RULE_example.md',
        content: `# 「群名」(群号) 群规则

## 群定位与氛围
- 一句话描述群聊定位

## 话题偏好
- 主要话题1
- 主要话题2

## 群内梗/黑话
- "梗名"：解释

## 聊天风格
- 风格描述

## 注意事项
- 注意事项1
`,
      },
    ];

    for (const f of exampleFiles) {
      if (!fs.existsSync(f.path)) {
        fs.writeFileSync(f.path, f.content, 'utf-8');
        console.log(chalk.green(`  ✓ ${f.label}`));
      }
    }

    console.log(chalk.green(`✓ Initialized social directory: ${socialDir}`));
    console.log(chalk.gray(`  Config: ${socialDir}/config.json`));
    console.log(chalk.gray(`  Agent:  ${agentFile}`));
    console.log(chalk.gray('\nRun: agent-cli start'));
  });

// ============ config ============
program
  .command('config')
  .description('View or set configuration')
  .option('-d, --dir <path>', 'Social directory', './social')
  .action(async (opts) => {
    const socialDir = path.resolve(opts.dir);
    const config = await loadConfig(socialDir);
    console.log(JSON.stringify(config, null, 2));
  });

program
  .command('config-set')
  .description('Set a config value (dot notation)')
  .argument('<key>', 'Config key, e.g. "llm.model"')
  .argument('<value>', 'Config value (JSON parsed)')
  .option('-d, --dir <path>', 'Social directory', './social')
  .action(async (key, value, opts) => {
    const socialDir = path.resolve(opts.dir);
    const config = await loadConfig(socialDir);

    // Parse value as JSON, fallback to string
    let parsedValue: unknown;
    try { parsedValue = JSON.parse(value); } catch { parsedValue = value; }

    // Set nested key
    const keys = key.split('.');
    let obj: Record<string, unknown> = config as unknown as Record<string, unknown>;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!(keys[i] in obj)) obj[keys[i]] = {};
      obj = obj[keys[i]] as Record<string, unknown>;
    }
    obj[keys[keys.length - 1]] = parsedValue;

    await saveConfig(config);
    console.log(chalk.green(`✓ Set ${key} = ${JSON.stringify(parsedValue)}`));
  });

// ============ test-llm ============
program
  .command('test-llm')
  .description('Test LLM connectivity with a simple prompt')
  .option('-d, --dir <path>', 'Social directory', './social')
  .option('-m, --message <text>', 'Test prompt', 'Return "ok" if you can read this.')
  .action(async (opts) => {
    const socialDir = path.resolve(opts.dir);
    const config = await loadConfig(socialDir);
    const llmConfig = resolveLlmConfig(config);

    if (!llmConfig.apiKey) {
      console.error(chalk.red('✖ No API key configured.'));
      console.error(chalk.gray('  Set LLM_API_KEY in .env file or LLM_API_KEY env var'));
      process.exit(1);
    }

    const provider = llmConfig.baseUrl.includes('opencode.ai') ? 'OpenCode Go' : llmConfig.baseUrl.includes('deepseek') ? 'DeepSeek' : llmConfig.baseUrl;
    console.log(chalk.cyan(`\n🔧 Testing LLM connection...`));
    console.log(chalk.gray(`  Provider: ${provider}`));
    console.log(chalk.gray(`  Model:    ${llmConfig.model}`));
    console.log(chalk.gray(`  Base URL: ${llmConfig.baseUrl}`));
    console.log(chalk.gray(`  Prompt:   "${opts.message}"`));

    try {
      const messages: Message[] = [
        { role: 'system', content: 'You are a helpful assistant. Respond concisely.' },
        { role: 'user', content: opts.message },
      ];

      console.log(chalk.cyan('\n⏳ Calling LLM...'));
      const startTime = Date.now();
      const result = await callLLM(llmConfig, messages);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      console.log(chalk.green(`\n✅ Response (${elapsed}s):`));
      console.log(chalk.white(`  ${result.content}`));

      if (result.reasoningContent) {
        console.log(chalk.gray(`\n  Reasoning: ${result.reasoningContent.slice(0, 200)}...`));
      }
      if (result.usage) {
        console.log(chalk.gray(`\n  Usage: in=${result.usage.inputTokens} out=${result.usage.outputTokens}${result.usage.cachedTokens ? ` cached=${result.usage.cachedTokens}` : ''}`));
      }
    } catch (err) {
      console.error(chalk.red(`\n✖ Error: ${err}`));
      process.exit(1);
    }
  });

// ============ mock ============
program
  .command('mock')
  .description('Start a mock MCP server (for testing)')
  .action(async () => {
    console.log(chalk.cyan('Starting mock MCP server...'));
    await startMockMcpServer();
  });

// ============ run ============
program.parse(process.argv);

// 如果没有参数，显示帮助
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
