/**
 * MCP Connection Manager - 连接管理器
 * 管理多个 MCP 客户端的生命周期和连接池
 */

import type { McpModule, McpTool } from "../types";
import { McpClientFactory, McpBaseClient } from "../client";

// 工具缓存项
interface ToolCacheEntry {
  tools: McpTool[];
  expiresAt: number;
}

export class McpConnectionManager {
  private clients = new Map<string, McpBaseClient>();
  private toolCache = new Map<string, ToolCacheEntry>();
  private readonly toolCacheTtlMs = 60 * 1000; // 1分钟缓存

  /**
   * 注册模块（不立即连接）
   */
  registerModule(module: McpModule): void {
    if (!module.isEnabled) {
      return;
    }

    // 如果已存在，先断开
    if (this.clients.has(module.moduleKey)) {
      void this.disconnectModule(module.moduleKey);
    }

    const client = McpClientFactory.createClient(module);
    this.clients.set(module.moduleKey, client);
  }

  /**
   * 注册多个模块
   */
  registerModules(modules: McpModule[]): void {
    for (const module of modules) {
      this.registerModule(module);
    }
  }

  /**
   * 连接指定模块
   */
  async connectModule(moduleKey: string): Promise<void> {
    const client = this.clients.get(moduleKey);
    if (!client) {
      throw new Error(`Module not registered: ${moduleKey}`);
    }

    if (client.isConnected()) {
      return;
    }

    await client.connect();
  }

  /**
   * 连接所有模块
   */
  async connectAll(): Promise<{ success: string[]; failed: Array<{ key: string; error: string }> }> {
    const success: string[] = [];
    const failed: Array<{ key: string; error: string }> = [];

    for (const [key, client] of this.clients.entries()) {
      try {
        if (!client.isConnected()) {
          await client.connect();
        }
        success.push(key);
      } catch (error) {
        failed.push({
          key,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { success, failed };
  }

  /**
   * 断开指定模块
   * 仅当 map 中的 client 仍是当前实例时才删除，避免 registerModule 替换时的竞态
   */
  async disconnectModule(moduleKey: string): Promise<void> {
    const client = this.clients.get(moduleKey);
    if (client) {
      await client.disconnect();
      if (this.clients.get(moduleKey) === client) {
        this.clients.delete(moduleKey);
        this.toolCache.delete(moduleKey);
      }
    }
  }

  /**
   * 断开所有模块
   */
  async disconnectAll(): Promise<void> {
    const promises = Array.from(this.clients.keys()).map(key => 
      this.disconnectModule(key).catch(err => 
        console.error(`[MCP:${key}] Error during disconnect:`, err)
      )
    );
    await Promise.all(promises);
    this.clients.clear();
    this.toolCache.clear();
  }

  /**
   * 获取模块的工具列表（带缓存）
   */
  async listTools(moduleKey: string): Promise<McpTool[]> {
    // 检查缓存
    const cached = this.toolCache.get(moduleKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.tools;
    }

    const client = this.clients.get(moduleKey);
    if (!client) {
      throw new Error(`Module not registered: ${moduleKey}`);
    }

    // 确保已连接
    if (!client.isConnected()) {
      await client.connect();
    }

    // 获取工具列表
    const allTools: McpTool[] = [];
    let cursor: string | undefined;
    
    for (let page = 0; page < 4; page++) {
      const result = await client.listTools(cursor);
      allTools.push(...result.tools);
      
      if (!result.nextCursor) {
        break;
      }
      cursor = result.nextCursor;
    }

    // 更新缓存
    this.toolCache.set(moduleKey, {
      tools: allTools,
      expiresAt: Date.now() + this.toolCacheTtlMs,
    });

    return allTools;
  }

  /**
   * 调用工具
   */
  async callTool(
    moduleKey: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<ReturnType<McpBaseClient["callTool"]>> {
    const client = this.clients.get(moduleKey);
    if (!client) {
      throw new Error(`Module not registered: ${moduleKey}`);
    }

    if (!client.isConnected()) {
      await client.connect();
    }

    return client.callTool(toolName, args);
  }

  /**
   * 获取客户端
   */
  getClient(moduleKey: string): McpBaseClient | undefined {
    return this.clients.get(moduleKey);
  }

  /**
   * 获取所有客户端
   */
  getAllClients(): Map<string, McpBaseClient> {
    return new Map(this.clients);
  }

  /**
   * 检查模块是否已注册
   */
  isRegistered(moduleKey: string): boolean {
    return this.clients.has(moduleKey);
  }

  /**
   * 检查模块是否已连接
   */
  isConnected(moduleKey: string): boolean {
    return this.clients.get(moduleKey)?.isConnected() ?? false;
  }

  /**
   * 清除工具缓存
   */
  clearToolCache(moduleKey?: string): void {
    if (moduleKey) {
      this.toolCache.delete(moduleKey);
    } else {
      this.toolCache.clear();
    }
  }

  /**
   * 获取连接统计
   */
  getStats(): {
    total: number;
    connected: number;
    disconnected: number;
    error: number;
  } {
    let connected = 0;
    let disconnected = 0;
    let error = 0;

    for (const client of this.clients.values()) {
      const state = client.getState();
      switch (state.status) {
        case "connected":
          connected++;
          break;
        case "disconnected":
          disconnected++;
          break;
        case "error":
          error++;
          break;
      }
    }

    return {
      total: this.clients.size,
      connected,
      disconnected,
      error,
    };
  }
}

// 全局单例
let globalManager: McpConnectionManager | null = null;

export function getGlobalConnectionManager(): McpConnectionManager {
  if (!globalManager) {
    globalManager = new McpConnectionManager();
  }
  return globalManager;
}

export function resetGlobalConnectionManager(): void {
  if (globalManager) {
    void globalManager.disconnectAll();
    globalManager = null;
  }
}
