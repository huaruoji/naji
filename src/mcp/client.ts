/**
 * MCP 客户端
 *
 * - stdio: 本地 spawn MCP server
 * - streamable-http: 连接独立常驻 MCP 服务
 */
import { createRequire } from 'node:module';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client';
import type { ToolDefinition, ToolResult } from '../types.js';

const require = createRequire(import.meta.url);
const sdkClientDir = path.dirname(require.resolve('@modelcontextprotocol/sdk/client'));
const { StdioClientTransport } = require(path.join(sdkClientDir, 'stdio.js'));
const { StreamableHTTPClientTransport } = require(path.join(sdkClientDir, 'streamableHttp.js'));

export type McpServerTransport = 'stdio' | 'streamable-http';

export interface McpServerOptions {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  transport?: McpServerTransport;
  url?: string;
}

type SdkClient = InstanceType<typeof Client>;

export class McpClient {
  private client: SdkClient | null = null;
  private transport: { close?: () => Promise<void> | void } | null = null;
  private tools: ToolDefinition[] = [];
  private initialized = false;

  constructor(private options: McpServerOptions) {}

  async start(): Promise<void> {
    if (this.initialized) return;

    const transportKind = this.options.transport ?? (this.options.url ? 'streamable-http' : 'stdio');

    if (transportKind === 'streamable-http') {
      if (!this.options.url) {
        throw new Error('MCP url is required for streamable-http transport');
      }
      this.transport = new StreamableHTTPClientTransport(new URL(this.options.url));
    } else {
      if (!this.options.command) {
        throw new Error('MCP command is required for stdio transport');
      }
      this.transport = new StdioClientTransport({
        command: this.options.command,
        args: this.options.args ?? [],
        env: this.options.env ? { ...process.env, ...this.options.env } : undefined,
        stderr: 'pipe',
      });
    }

    const client = new Client({ name: 'naji', version: '0.1.0' });
    await client.connect(this.transport as never);
    this.client = client;
    await this.refreshTools();
    this.initialized = true;
  }

  stop(): void {
    this.initialized = false;
    this.tools = [];
    const client = this.client;
    this.client = null;
    this.transport = null;
    void client?.close().catch(() => {});
  }

  getTools(): ToolDefinition[] {
    return [...this.tools];
  }

  async refreshTools(): Promise<void> {
    if (!this.client) throw new Error('MCP client not connected');
    const result = await this.client.listTools();
    this.tools = (result.tools || []).map(t => ({
      name: t.name,
      description: t.description || '',
      inputSchema: (t.inputSchema as Record<string, unknown>) || {},
    }));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (!this.client) throw new Error('MCP client not connected');
    const result = await this.client.callTool({ name, arguments: args });
    const content = 'content' in result && Array.isArray(result.content)
      ? result.content.map(item => ({
          type: item.type,
          text: 'text' in item ? item.text : undefined,
        }))
      : [{ type: 'text', text: JSON.stringify(result) }];
    return {
      content,
      isError: 'isError' in result ? Boolean(result.isError) : undefined,
    };
  }

  get isConnected(): boolean {
    return this.initialized;
  }
}
