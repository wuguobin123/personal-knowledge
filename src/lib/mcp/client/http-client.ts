/**
 * MCP HTTP Client - Streamable HTTP 传输
 * 基于 @modelcontextprotocol/sdk/client/streamableHttp.js
 */

import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpBaseClient } from "./base-client";

export class McpHttpClient extends McpBaseClient {
  private transport: StreamableHTTPClientTransport | null = null;

  async connect(): Promise<void> {
    if (this.isConnected()) {
      console.log(`[MCP:${this.module.moduleKey}] HTTP already connected`);
      return;
    }

    console.log(`[MCP:${this.module.moduleKey}] HTTP connecting to ${this.module.endpointUrl}...`);
    this.updateState({ status: "connecting" });

    try {
      // 创建 HTTP 传输 - 注意：StreamableHTTPClientTransport 可能需要特殊处理
      const url = new URL(this.module.endpointUrl);
      console.log(`[MCP:${this.module.moduleKey}] Creating StreamableHTTPClientTransport for ${url.toString()}`);
      
      this.transport = new StreamableHTTPClientTransport(url);

      // 创建客户端
      this.client = this.createClient();
      console.log(`[MCP:${this.module.moduleKey}] Client created, calling connect()...`);

      // 建立连接
      await this.client.connect(this.transport);

      this.updateState({ 
        status: "connected", 
        lastConnectedAt: new Date(),
        retryCount: 0,
        error: undefined,
      });

      console.log(`[MCP:${this.module.moduleKey}] ✓ HTTP client connected`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[MCP:${this.module.moduleKey}] ✗ HTTP connection failed: ${message}`);
      if (error instanceof Error && error.stack) {
        console.error(`[MCP:${this.module.moduleKey}] Stack: ${error.stack}`);
      }
      this.updateState({ 
        status: "error", 
        error: message,
        retryCount: this.state.retryCount + 1,
      });
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    await super.disconnect();
    if (this.transport) {
      try {
        await this.transport.close();
      } catch (error) {
        console.warn(`[MCP:${this.module.moduleKey}] Error closing transport:`, error);
      }
      this.transport = null;
    }
  }
}
