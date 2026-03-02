import { z } from "zod";
import { getAdminSession } from "@/lib/auth";
import { createQaMcpModule, listQaMcpModules } from "@/lib/qa/mcp-modules";

export const runtime = "nodejs";

const listQuerySchema = z.object({
  q: z.string().trim().max(80).optional().default(""),
  enabled: z.enum(["all", "enabled"]).optional().default("all"),
});

const createMcpModuleSchema = z.object({
  label: z.string().trim().min(1).max(120),
  description: z.string().trim().max(400).optional(),
  transport: z.enum(["streamable_http", "sse", "stdio"]).optional(),
  endpointUrl: z.string().trim().url().max(500).optional(),
  url: z.string().trim().url().max(500).optional(),
  command: z.string().trim().max(260).optional(),
  args: z.array(z.string().trim().max(260)).max(80).optional().default([]),
  env: z.record(z.string(), z.string()).optional().default({}),
  cwd: z.string().trim().max(500).optional(),
  modeHint: z.enum(["auto", "blog", "web"]).optional().default("auto"),
  keywordHints: z.array(z.string().trim().min(1).max(80)).max(20).optional().default([]),
  toolAllowlist: z.array(z.string().trim().min(1).max(120)).max(60).optional().default([]),
  headers: z.record(z.string(), z.string()).optional().default({}),
  isEnabled: z.boolean().optional().default(true),
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

function formatErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "Failed to process MCP module request.";
}

export async function GET(request: Request) {
  const session = await getAdminSession();
  if (!session) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const parsedQuery = listQuerySchema.safeParse({
    q: searchParams.get("q") || "",
    enabled: searchParams.get("enabled") || "all",
  });
  if (!parsedQuery.success) {
    return Response.json(
      { error: "Invalid request query.", details: parsedQuery.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const modules = await listQaMcpModules({
      enabledOnly: parsedQuery.data.enabled === "enabled",
    });
    const keyword = parsedQuery.data.q.toLowerCase();
    const filtered = keyword
      ? modules.filter((item) =>
          [
            item.moduleKey,
            item.label,
            item.description,
            item.endpointUrl,
            JSON.stringify(item.connectionConfig || {}),
            item.keywordHints.join(" "),
            item.toolAllowlist.join(" "),
          ]
            .map((value) => value.toLowerCase())
            .some((value) => value.includes(keyword)),
        )
      : modules;

    return Response.json({
      modules: filtered,
      total: filtered.length,
      q: parsedQuery.data.q,
      enabled: parsedQuery.data.enabled,
    });
  } catch (error) {
    return Response.json({ error: formatErrorMessage(error) }, { status: 500 });
  }
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

  const parsed = createMcpModuleSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request payload.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const description = parsed.data.description?.trim() || `${parsed.data.label} (MCP 模块)`;
  const command = parsed.data.command?.trim() || "";
  const endpointUrlRaw = parsed.data.endpointUrl?.trim() || parsed.data.url?.trim() || "";
  const transport = parsed.data.transport || (command ? "stdio" : endpointUrlRaw ? "streamable_http" : undefined);
  const endpointUrl =
    transport === "stdio"
      ? "stdio://local"
      : endpointUrlRaw;
  const normalizedTransport =
    transport === "stdio"
      ? "stdio"
      : endpointUrl.toLowerCase().includes("/sse")
        ? "sse"
        : "streamable_http";
  const headers = Object.entries(parsed.data.headers || {}).reduce<Record<string, string>>(
    (acc, [key, value]) => {
      const headerKey = String(key || "").trim();
      const headerValue = String(value || "").trim();
      if (!headerKey || !headerValue) {
        return acc;
      }
      acc[headerKey] = headerValue;
      return acc;
    },
    {},
  );
  const keywordHints = Array.from(
    new Set((parsed.data.keywordHints || []).map((item) => item.trim()).filter(Boolean)),
  ).slice(0, 20);
  const toolAllowlist = Array.from(
    new Set((parsed.data.toolAllowlist || []).map((item) => item.trim()).filter(Boolean)),
  ).slice(0, 60);
  const connectionConfig =
    normalizedTransport === "stdio"
      ? {
          command,
          args: Array.from(new Set((parsed.data.args || []).map((item) => item.trim()).filter(Boolean))).slice(
            0,
            80,
          ),
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

  try {
    const created = await createQaMcpModule({
      label: parsed.data.label,
      description,
      transport: normalizedTransport,
      endpointUrl,
      headers,
      connectionConfig,
      keywordHints,
      toolAllowlist,
      modeHint: parsed.data.modeHint,
      isEnabled: parsed.data.isEnabled,
    });

    return Response.json({
      module: created,
    });
  } catch (error) {
    return Response.json({ error: formatErrorMessage(error) }, { status: 500 });
  }
}
