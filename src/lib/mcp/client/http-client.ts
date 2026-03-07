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
      return;
    }

    this.updateState({ status: "connecting" });

    try {
      // 创建 HTTP 传输
      this.transport = new StreamableHTTPClientTransport(
        new URL(this.module.endpointUrl)
      );

      // 创建客户端
      this.client = this.createClient();

      // 建立连接
      await this.client.connect(this.transport);

      this.updateState({ 
        status: "connected", 
        lastConnectedAt: new Date(),
        retryCount: 0,
        error: undefined,
      });

      console.log(`[MCP:${this.module.moduleKey}] HTTP client connected`);
    } catch (error) {
      this.updateState({ 
        status: "error", 
        error: error instanceof Error ? error.message : String(error),
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
