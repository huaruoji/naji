#!/usr/bin/env tsx

/**
 * Mock MCP Server
 *
 * 模拟 Amadeus-QQ-MCP 的部分接口，用于无真实 QQ 环境测试。
 *
 * 支持的 MCP 工具：
 * - send_message: 发送消息（只输出到控制台）
 * - get_group_msg_history: 返回模拟的群消息
 * - get_friend_msg_history: 返回模拟的好友消息
 * - batch_get_recent_context: 批量获取最新上下文
 * - get_login_info: 返回模拟登录信息
 */

import readline from 'node:readline';

interface JsonRpcMessage {
  jsonrpc: string;
  id?: number;
  method: string;
  params?: Record<string, unknown>;
}

// ============ Mock Data ============
// 基于用户真实群聊 "明睿宝妈宝爸交流群" (699242647) 的对话

const MOCK_GROUPS = [
  { group_id: 699242647, group_name: '明睿宝妈宝爸交流群' },
];

const MOCK_USERS = [
  { user_id: 2532452182, nickname: '兼职派肉骨鸡' },
  { user_id: 2682801195, nickname: '豪大大鸡排' },
  { user_id: 3065392752, nickname: '五八同城节快乐' },
  { user_id: 2793847165, nickname: '歼姦挖淦奶' },
];

const MOCK_MESSAGES: Record<string, Array<Record<string, unknown>>> = {
  '699242647': [
    { message_id: '10', sender_id: 2532452182, sender_name: '兼职派肉骨鸡', content: '特朗普访华了你们知道吗', timestamp: new Date(Date.now() - 600000).toISOString() },
    { message_id: '11', sender_id: 2793847165, sender_name: '歼姦挖淦奶', content: '看到了，股市都跌了', timestamp: new Date(Date.now() - 590000).toISOString() },
    { message_id: '12', sender_id: 2682801195, sender_name: '豪大大鸡排', content: '确实，我买的基金都绿了', timestamp: new Date(Date.now() - 580000).toISOString() },
    { message_id: '13', sender_id: 2532452182, sender_name: '兼职派肉骨鸡', content: '@me 你知道特朗普来了？你有websearch工具吗', timestamp: new Date(Date.now() - 300000).toISOString() },
    { message_id: '14', sender_id: 2532452182, sender_name: '兼职派肉骨鸡', content: '哎这作者写的什么代码，缓存根本没命中', timestamp: new Date(Date.now() - 290000).toISOString() },
    { message_id: '15', sender_id: 2532452182, sender_name: '兼职派肉骨鸡', content: '调一会就花五块多', timestamp: new Date(Date.now() - 280000).toISOString() },
    { message_id: '16', sender_id: 2532452182, sender_name: '兼职派肉骨鸡', content: '但是这个社交循环看着挺好的', timestamp: new Date(Date.now() - 270000).toISOString() },
    { message_id: '17', sender_id: 3065392752, sender_name: '五八同城节快乐', content: '@me 给你换成0.8b得了', timestamp: new Date(Date.now() - 250000).toISOString() },
    { message_id: '18', sender_id: 3065392752, sender_name: '五八同城节快乐', content: '0.8b', timestamp: new Date(Date.now() - 245000).toISOString() },
    { message_id: '19', sender_id: 2532452182, sender_name: '兼职派肉骨鸡', content: '@me 你太费钱了喵，我要不要自己把你改造成省钱的版本', timestamp: new Date(Date.now() - 120000).toISOString() },
    { message_id: '20', sender_id: 2532452182, sender_name: '兼职派肉骨鸡', content: '@me 回复一下', timestamp: new Date(Date.now() - 60000).toISOString() },
  ],
  '2532452182': [
    { message_id: '101', sender_id: 2532452182, sender_name: '兼职派肉骨鸡', content: '你对2716599708的记忆是什么？', timestamp: new Date(Date.now() - 120000).toISOString() },
    { message_id: '102', sender_id: 2532452182, sender_name: '兼职派肉骨鸡', content: '讲个笑话', timestamp: new Date(Date.now() - 30000).toISOString() },
  ],
};

// ============ MCP Server Loop ============

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

let initialized = false;

function sendResponse(id: number | undefined, result: unknown): void {
  const response = {
    jsonrpc: '2.0',
    id,
    result,
  };
  console.log(JSON.stringify(response));
}

function sendError(id: number | undefined, code: number, message: string): void {
  const response = {
    jsonrpc: '2.0',
    id,
    error: { code, message },
  };
  console.log(JSON.stringify(response));
}

function handleRequest(msg: JsonRpcMessage): void {
  const { id, method, params } = msg;

  switch (method) {
    case 'initialize':
      initialized = true;
      sendResponse(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'mock-qq-mcp', version: '0.1.0' },
      });
      break;

    case 'notifications/initialized':
      // No response needed
      break;

    case 'tools/list':
      sendResponse(id, {
        tools: [
          {
            name: 'send_message',
            description: '发送消息到群聊或私聊',
            inputSchema: {
              type: 'object',
              properties: {
                content: { type: 'string' },
                target: { type: 'string' },
                target_type: { type: 'string', enum: ['group', 'private'] },
              },
              required: ['content', 'target', 'target_type'],
            },
          },
          {
            name: 'get_group_msg_history',
            description: '获取群聊历史消息',
            inputSchema: {
              type: 'object',
              properties: {
                group_id: { type: 'number' },
                count: { type: 'number' },
              },
            },
          },
          {
            name: 'get_friend_msg_history',
            description: '获取好友聊天历史',
            inputSchema: {
              type: 'object',
              properties: {
                user_id: { type: 'number' },
                count: { type: 'number' },
              },
            },
          },
          {
            name: 'batch_get_recent_context',
            description: '批量获取所有 target 最新消息',
            inputSchema: { type: 'object', properties: {} },
          },
          {
            name: 'get_login_info',
            description: '获取当前登录信息',
            inputSchema: { type: 'object', properties: {} },
          },
          {
            name: 'check_status',
            description: '检查 NapCat / QQ 在线状态',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      });
      break;

    case 'tools/call': {
      const toolName = params?.name as string;
      const toolArgs = params?.arguments as Record<string, unknown> || {};

      switch (toolName) {
        case 'send_message':
          console.error(`[MOCK SEND] To ${toolArgs.target}: ${toolArgs.content}`);
          sendResponse(id, {
            content: [{ type: 'text', text: JSON.stringify({ success: true, message_id: `mock_${Date.now()}` }) }],
          });
          break;

        case 'get_group_msg_history': {
          const groupId = String(toolArgs.group_id || '');
          const messages = MOCK_MESSAGES[groupId] || [];
          const count = (toolArgs.count as number) || 20;
          sendResponse(id, {
            content: [{ type: 'text', text: JSON.stringify(messages.slice(-count)) }],
          });
          break;
        }

        case 'get_friend_msg_history': {
          const userId = String(toolArgs.user_id || '');
          sendResponse(id, {
            content: [{ type: 'text', text: JSON.stringify([]) }],
          });
          break;
        }

        case 'batch_get_recent_context': {
          const targets = (toolArgs.targets as Array<{ target: string; target_type: 'group' | 'private' }> | undefined) || [];
          const results = targets.map(t => ({
            target: t.target,
            target_type: t.target_type,
            messages: (MOCK_MESSAGES[String(t.target)] || []).slice(-10),
          }));
          sendResponse(id, {
            content: [{ type: 'text', text: JSON.stringify({ results }) }],
          });
          break;
        }

        case 'get_login_info':
          sendResponse(id, {
            content: [{ type: 'text', text: JSON.stringify({ user_id: 123456789, nickname: 'MockBot' }) }],
          });
          break;

        case 'check_status':
          sendResponse(id, {
            content: [{ type: 'text', text: JSON.stringify({ napcat_running: true, qq_logged_in: true, qq_account: '123456789', qq_nickname: 'MockBot', online_status: 'online' }) }],
          });
          break;

        default:
          sendResponse(id, {
            content: [{ type: 'text', text: `Unknown tool: ${toolName}` }],
            isError: true,
          });
      }
      break;
    }

    default:
      sendError(id, -32601, `Method not found: ${method}`);
  }
}

/**
 * 启动 Mock MCP 服务器（作为独立进程运行时调用）
 */
export async function startMockMcpServer(): Promise<void> {
  // 当作为独立进程运行时，stdin/stdout 已就绪
  console.error('[Mock MCP] Server ready');
}

// 当直接作为脚本运行时（如 npx tsx mock-mcp.ts）
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('mock-mcp.ts')) {
  rl.on('line', (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const msg = JSON.parse(trimmed) as JsonRpcMessage;
      handleRequest(msg);
    } catch {
      // Ignore malformed JSON
    }
  });
  console.error('[Mock MCP] Server ready');
}
