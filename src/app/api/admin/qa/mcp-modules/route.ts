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
  endpointUrl: z.string().trim().url().max(500),
  modeHint: z.enum(["auto", "blog", "web"]).optional().default("auto"),
  keywordHints: z.array(z.string().trim().min(1).max(80)).max(20).optional().default([]),
  toolAllowlist: z.array(z.string().trim().min(1).max(120)).max(60).optional().default([]),
  headers: z.record(z.string(), z.string()).optional().default({}),
  isEnabled: z.boolean().optional().default(true),
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

  try {
    const created = await createQaMcpModule({
      label: parsed.data.label,
      description,
      endpointUrl: parsed.data.endpointUrl,
      headers,
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
