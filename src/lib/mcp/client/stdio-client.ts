/**
 * MCP STDIO Client - 标准输入输出传输
 * 基于 @modelcontextprotocol/sdk/client/stdio.js
 */

import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { McpBaseClient } from "./base-client";
interface McpStdioConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
}

export class McpStdioClient extends McpBaseClient {
  private transport: StdioClientTransport | null = null;

  async connect(): Promise<void> {
    if (this.isConnected()) {
      return;
    }

    this.updateState({ status: "connecting" });

    try {
      const config = this.parseStdioConfig();
      if (!config) {
        throw new Error("Invalid STDIO configuration: command is required");
      }

      // 创建 STDIO 传输
      this.transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: { ...process.env, ...config.env } as Record<string, string>,
        cwd: config.cwd,
      });

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

      console.log(`[MCP:${this.module.moduleKey}] STDIO client connected`);
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
        console.warn(`[MCP:${this.module.moduleKey}] Error closing STDIO transport:`, error);
      }
      this.transport = null;
    }
  }

  /**
   * 解析 STDIO 配置
   */
  private parseStdioConfig(): McpStdioConfig | null {
    const config = this.module.connectionConfig;
    if (!config || typeof config !== "object") {
      return null;
    }

    const command = typeof config.command === "string" ? config.command.trim() : "";
    if (!command) return null;

    const args = Array.isArray(config.args)
      ? config.args
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean)
      : [];

    const env =
      config.env && typeof config.env === "object" && !Array.isArray(config.env)
        ? Object.entries(config.env as Record<string, unknown>).reduce<Record<string, string>>(
            (acc, [key, rawValue]) => {
              const envKey = String(key || "").trim();
              if (!envKey) return acc;
              if (typeof rawValue !== "string" && typeof rawValue !== "number" && typeof rawValue !== "boolean") {
                return acc;
              }
              acc[envKey] = String(rawValue);
              return acc;
            },
            {}
          )
        : {};

    const cwd = typeof config.cwd === "string" && config.cwd.trim() ? config.cwd.trim() : undefined;

    return { command, args, env, cwd };
  }
}

interface McpStdioConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
}
