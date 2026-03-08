/**
 * MCP Base Client - 基于 @modelcontextprotocol/sdk 的封装
 * 提供统一的客户端接口
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { McpModule, McpTool, McpToolResult, McpConnectionState, McpClientOptions } from "../types";

export const DEFAULT_MCP_OPTIONS: McpClientOptions = {
  timeoutMs: 25000,
  maxRetries: 3,
  autoConnect: true,
};

export abstract class McpBaseClient {
  protected client: Client | null = null;
  protected state: McpConnectionState = {
    status: "disconnected",
    retryCount: 0,
  };
  protected options: McpClientOptions;

  constructor(
    protected module: McpModule,
    options: McpClientOptions = {}
  ) {
    this.options = { ...DEFAULT_MCP_OPTIONS, ...options };
  }

  /**
   * 获取连接状态
   */
  getState(): McpConnectionState {
    return { ...this.state };
  }

  /**
   * 是否已连接
   */
  isConnected(): boolean {
    return this.state.status === "connected" && this.client !== null;
  }

  /**
   * 连接服务器（子类实现）
   */
  abstract connect(): Promise<void>;

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.close();
      } catch (error) {
        console.warn(`[MCP:${this.module.moduleKey}] Error during disconnect:`, error);
      }
      this.client = null;
    }
    this.state = { status: "disconnected", retryCount: 0 };
  }

  /**
   * 列出可用工具
   */
  async listTools(cursor?: string): Promise<{ tools: McpTool[]; nextCursor?: string }> {
    this.ensureConnected();
    
    console.log(`[MCP:${this.module.moduleKey}] Listing tools...`);
    const response = await this.client!.listTools(cursor ? { cursor } : undefined);
    
    // 过滤白名单
    let tools = response.tools || [];
    const beforeFilter = tools.length;
    if (this.module.toolAllowlist.length > 0) {
      tools = tools.filter(tool => this.module.toolAllowlist.includes(tool.name));
      console.log(`[MCP:${this.module.moduleKey}] Filtered by allowlist: ${beforeFilter} -> ${tools.length} tools`);
    }

    console.log(`[MCP:${this.module.moduleKey}] Listed ${tools.length} tools`);
    return {
      tools: tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
      nextCursor: response.nextCursor,
    };
  }

  /**
   * 调用工具
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    this.ensureConnected();

    console.log(`[MCP:${this.module.moduleKey}] Calling tool: ${name}`);
    const result = await this.client!.callTool({
      name,
      arguments: args,
    }, undefined, { timeout: this.options.timeoutMs });
    console.log(`[MCP:${this.module.moduleKey}] Tool ${name} returned`);

    const contentItems = result.content as Array<{
      type: string;
      text?: string;
      data?: string;
      mimeType?: string;
      resource?: { uri?: string; mimeType?: string };
    }>;

    return {
      content: contentItems.map(item => {
        if (item.type === "text") {
          return { type: "text" as const, text: item.text };
        }
        if (item.type === "image") {
          return { type: "image" as const, data: item.data, mimeType: item.mimeType };
        }
        if (item.type === "resource") {
          return { 
            type: "resource" as const, 
            uri: item.resource?.uri,
            mimeType: item.resource?.mimeType 
          };
        }
        return { type: "text" as const };
      }),
      isError: result.isError as boolean | undefined,
    };
  }

  /**
   * 确保已连接
   */
  protected ensureConnected(): void {
    if (!this.isConnected()) {
      console.error(`[MCP:${this.module.moduleKey}] Client not connected! Current state: ${this.state.status}`);
      throw new Error(`MCP client not connected: ${this.module.moduleKey}`);
    }
  }

  /**
   * 更新状态
   */
  protected updateState(updates: Partial<McpConnectionState>): void {
    this.state = { ...this.state, ...updates };
  }

  /**
   * 创建标准 Client 实例
   */
  protected createClient(): Client {
    return new Client(
      {
        name: "personal-knowledge-qa",
        version: "0.1.0",
      },
      {
        capabilities: {},
      }
    );
  }
}
