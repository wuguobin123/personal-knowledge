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
      console.log(`[MCP:${this.module.moduleKey}] STDIO already connected`);
      return;
    }

    const startTime = Date.now();
    console.log(`[MCP:${this.module.moduleKey}] STDIO connecting...`);
    this.updateState({ status: "connecting" });

    try {
      const config = this.parseStdioConfig();
      if (!config) {
        throw new Error("Invalid STDIO configuration: command is required");
      }

      console.log(`[MCP:${this.module.moduleKey}] STDIO config: command=${config.command}, args=[${config.args.join(', ')}], cwd=${config.cwd || '(default)'}`);
      console.log(`[MCP:${this.module.moduleKey}] STDIO starting process... This may take a while for first-time startup`);

      // 创建 STDIO 传输
      this.transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: { ...process.env, ...config.env } as Record<string, string>,
        cwd: config.cwd,
      });

      // 创建客户端
      this.client = this.createClient();

      // 建立连接（使用更长的超时）
      console.log(`[MCP:${this.module.moduleKey}] STDIO establishing MCP connection...`);
      const connectStartTime = Date.now();
      
      // 包装连接过程，添加进度日志
      const connectPromise = this.client.connect(this.transport);
      const progressInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - connectStartTime) / 1000);
        console.log(`[MCP:${this.module.moduleKey}] STDIO still connecting... (${elapsed}s elapsed)`);
      }, 10000); // 每10秒报告一次进度
      
      await connectPromise;
      clearInterval(progressInterval);
      
      const totalTime = Date.now() - startTime;
      console.log(`[MCP:${this.module.moduleKey}] ✓ STDIO client connected in ${totalTime}ms`);

      this.updateState({ 
        status: "connected", 
        lastConnectedAt: new Date(),
        retryCount: 0,
        error: undefined,
      });
    } catch (error) {
      const totalTime = Date.now() - startTime;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[MCP:${this.module.moduleKey}] ✗ STDIO connection failed after ${totalTime}ms: ${message}`);
      
      // 提供更详细的错误信息
      if (message.includes("timeout") || message.includes("ETIMEDOUT")) {
        console.error(`[MCP:${this.module.moduleKey}] The STDIO server took too long to start. Consider:`);
        console.error(`  1. Checking if the command path is correct`);
        console.error(`  2. Verifying the server binary exists and is executable`);
        console.error(`  3. Checking server dependencies are installed`);
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
