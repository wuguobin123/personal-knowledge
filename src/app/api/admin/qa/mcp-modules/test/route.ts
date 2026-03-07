/**
 * MCP 连接测试 API
 * 基于 @modelcontextprotocol/sdk 的实现
 */

import { z } from "zod";
import { getAdminSession } from "@/lib/auth";
import { McpClientFactory } from "@/lib/mcp/client";
import type { McpModule, McpTransportType } from "@/lib/mcp/types";

export const runtime = "nodejs";

const testConnectionSchema = z.object({
  transport: z.enum(["streamable_http", "sse", "stdio"] as const).optional(),
  endpointUrl: z.string().trim().url().max(500).optional(),
  url: z.string().trim().url().max(500).optional(),
  command: z.string().trim().max(260).optional(),
  args: z.array(z.string().trim().max(260)).max(80).optional().default([]),
  env: z.record(z.string(), z.string()).optional().default({}),
  cwd: z.string().trim().max(500).optional(),
  headers: z.record(z.string(), z.string()).optional().default({}),
}).superRefine((value, ctx) => {
  const inferredTransport = value.command ? "stdio" : value.endpointUrl || value.url ? "streamable_http" : null;
  const transport = value.transport || inferredTransport;
  if (transport === "stdio") {
    if (!value.command || !value.command.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "command is required when transport is stdio.",
        path: ["command"],
      });
    }
    return;
  }

  if (!value.endpointUrl && !value.url) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "endpointUrl or url is required.",
      path: ["endpointUrl"],
    });
  }
});

function normalizeHeaders(input: Record<string, string>) {
  return Object.entries(input).reduce<Record<string, string>>((acc, [key, value]) => {
    const headerKey = String(key || "").trim();
    const headerValue = String(value || "").trim();
    if (!headerKey || !headerValue) {
      return acc;
    }
    acc[headerKey] = headerValue;
    return acc;
  }, {});
}

export async function POST(request: Request) {
  const session = await getAdminSession();
  if (!session) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const parsed = testConnectionSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request payload.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // 构建模块配置
  const headers = normalizeHeaders(parsed.data.headers || {});
  const endpointUrlRaw = parsed.data.endpointUrl?.trim() || parsed.data.url?.trim() || "";
  const command = parsed.data.command?.trim() || "";
  const transport: McpTransportType = parsed.data.transport || (command ? "stdio" : "streamable_http");
  const endpointUrl = transport === "stdio" ? "stdio://local" : endpointUrlRaw;

  const connectionConfig =
    transport === "stdio"
      ? {
          command,
          args: Array.from(new Set((parsed.data.args || []).map((item) => item.trim()).filter(Boolean))).slice(0, 80),
          env: Object.entries(parsed.data.env || {}).reduce<Record<string, string>>((acc, [key, value]) => {
            const envKey = String(key || "").trim();
            const envValue = String(value || "").trim();
            if (!envKey || !envValue) return acc;
            acc[envKey] = envValue;
            return acc;
          }, {}),
          ...(parsed.data.cwd?.trim() ? { cwd: parsed.data.cwd.trim() } : {}),
        }
      : {};

  // 构建临时模块配置
  const tempModule: McpModule = {
    id: 0,
    moduleKey: "test-connection",
    label: "Test Connection",
    description: "Temporary module for connection testing",
    transport,
    endpointUrl,
    headers,
    connectionConfig,
    keywordHints: [],
    toolAllowlist: [],
    modeHint: "auto",
    isEnabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // 创建客户端并测试连接
  const client = McpClientFactory.createClient(tempModule, { timeoutMs: 15000 });

  try {
    // 连接服务器
    await client.connect();

    // 获取工具列表
    let toolCount = 0;
    let sampleTools: string[] = [];
    try {
      const { tools } = await client.listTools();
      toolCount = tools.length;
      sampleTools = tools.slice(0, 5).map(t => t.name);
    } catch {
      // tools/list 是可选的，初始化成功就足够了
    }

    // 断开连接
    await client.disconnect();

    return Response.json({
      ok: true,
      message: "MCP 连接成功。",
      transport,
      endpointUrl,
      toolCount,
      sampleTools,
    });
  } catch (error) {
    // 确保断开连接
    try {
      await client.disconnect();
    } catch {
      // ignore cleanup error
    }

    const message = error instanceof Error ? error.message : "MCP 连接测试失败。";
    return Response.json({ error: message }, { status: 502 });
  }
}
