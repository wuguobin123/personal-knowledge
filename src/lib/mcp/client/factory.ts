/**
 * MCP Client Factory - 客户端工厂
 * 根据传输类型创建对应的客户端实例
 */

import type { McpModule, McpClientOptions } from "../types";
import { McpBaseClient } from "./base-client";
import { McpHttpClient } from "./http-client";
import { McpSseClient } from "./sse-client";
import { McpStdioClient } from "./stdio-client";

export class McpClientFactory {
  /**
   * 创建客户端实例
   */
  static createClient(module: McpModule, options?: McpClientOptions): McpBaseClient {
    switch (module.transport) {
      case "streamable_http":
        return new McpHttpClient(module, options);
      case "sse":
        return new McpSseClient(module, options);
      case "stdio":
        return new McpStdioClient(module, options);
      default:
        // 默认使用 HTTP
        console.warn(`[MCP:${module.moduleKey}] Unknown transport type: ${module.transport}, fallback to HTTP`);
        return new McpHttpClient(module, options);
    }
  }

  /**
   * 批量创建客户端
   */
  static createClients(modules: McpModule[], options?: McpClientOptions): Map<string, McpBaseClient> {
    const clients = new Map<string, McpBaseClient>();
    
    for (const module of modules) {
      if (module.isEnabled) {
        clients.set(module.moduleKey, this.createClient(module, options));
      }
    }

    return clients;
  }
}
