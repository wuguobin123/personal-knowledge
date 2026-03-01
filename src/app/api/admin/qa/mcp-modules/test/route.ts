import { z } from "zod";
import { getAdminSession } from "@/lib/auth";

export const runtime = "nodejs";

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: number;
  method: string;
  params?: unknown;
};

type JsonRpcResponse = {
  result?: unknown;
  error?: {
    message?: string;
  };
};

const testConnectionSchema = z.object({
  endpointUrl: z.string().trim().url().max(500),
  headers: z.record(z.string(), z.string()).optional().default({}),
});

function normalizeRpcEnvelope(payload: unknown): JsonRpcResponse {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { result: payload };
  }

  const envelope = payload as Record<string, unknown>;
  if ("result" in envelope || "error" in envelope || "jsonrpc" in envelope) {
    return envelope as JsonRpcResponse;
  }

  return { result: envelope };
}

function parseJsonObjectFromText(raw: string) {
  const cleaned = String(raw || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const matched = cleaned.match(/\{[\s\S]*\}/);
  if (!matched) return null;
  try {
    const parsed = JSON.parse(matched[0]) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function createRpcAbortController(timeoutMs: number, signal?: AbortSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("MCP request timeout.")), timeoutMs);

  if (signal) {
    if (signal.aborted) {
      controller.abort(signal.reason);
    } else {
      signal.addEventListener(
        "abort",
        () => {
          controller.abort(signal.reason);
        },
        { once: true },
      );
    }
  }

  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
    },
  };
}

async function parseRpcResponseBody(response: Response) {
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  const rawText = await response.text();

  if (!rawText.trim()) {
    return {} as JsonRpcResponse;
  }

  if (contentType.includes("application/json")) {
    try {
      return normalizeRpcEnvelope(JSON.parse(rawText));
    } catch {
      throw new Error(`MCP returned invalid JSON: ${rawText.slice(0, 260)}`);
    }
  }

  const dataLines = rawText
    .split(/\n/g)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter((line) => line && line !== "[DONE]");

  for (const line of dataLines.reverse()) {
    try {
      return normalizeRpcEnvelope(JSON.parse(line));
    } catch {
      // Try next line
    }
  }

  const fallback = parseJsonObjectFromText(rawText);
  if (fallback) {
    return normalizeRpcEnvelope(fallback);
  }

  throw new Error(`MCP returned unsupported response: ${rawText.slice(0, 260)}`);
}

async function postJsonRpc(input: {
  endpointUrl: string;
  headers: Record<string, string>;
  request: JsonRpcRequest;
  signal?: AbortSignal;
}) {
  const { signal, cleanup } = createRpcAbortController(12000, input.signal);

  try {
    const response = await fetch(input.endpointUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...input.headers,
      },
      body: JSON.stringify(input.request),
      signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 260)}`);
    }

    return await parseRpcResponseBody(response);
  } finally {
    cleanup();
  }
}

async function sendRpcRequest(input: {
  endpointUrl: string;
  headers: Record<string, string>;
  method: string;
  params?: unknown;
  signal?: AbortSignal;
}) {
  const response = await postJsonRpc({
    endpointUrl: input.endpointUrl,
    headers: input.headers,
    request: {
      jsonrpc: "2.0",
      id: Date.now(),
      method: input.method,
      params: input.params,
    },
    signal: input.signal,
  });

  if (response.error) {
    throw new Error(`${input.method} failed: ${String(response.error.message || "Unknown error.")}`);
  }
  return response.result;
}

async function sendRpcNotification(input: {
  endpointUrl: string;
  headers: Record<string, string>;
  method: string;
  params?: unknown;
  signal?: AbortSignal;
}) {
  await postJsonRpc({
    endpointUrl: input.endpointUrl,
    headers: input.headers,
    request: {
      jsonrpc: "2.0",
      method: input.method,
      params: input.params,
    },
    signal: input.signal,
  });
}

async function initializeMcp(input: {
  endpointUrl: string;
  headers: Record<string, string>;
  signal?: AbortSignal;
}) {
  const protocolVersions = ["2025-03-26", "2024-11-05"];
  let lastError: unknown;

  for (const protocolVersion of protocolVersions) {
    try {
      const result = (await sendRpcRequest({
        endpointUrl: input.endpointUrl,
        headers: input.headers,
        method: "initialize",
        params: {
          protocolVersion,
          capabilities: {},
          clientInfo: {
            name: "personal-knowledge-qa",
            version: "0.1.0",
          },
        },
        signal: input.signal,
      })) as Record<string, unknown> | undefined;

      try {
        await sendRpcNotification({
          endpointUrl: input.endpointUrl,
          headers: input.headers,
          method: "notifications/initialized",
          params: {},
          signal: input.signal,
        });
      } catch {
        // Ignore optional notification failure.
      }

      return {
        protocolVersion: typeof result?.protocolVersion === "string" ? result.protocolVersion : protocolVersion,
        serverInfo:
          result && typeof result.serverInfo === "object" && result.serverInfo
            ? (result.serverInfo as Record<string, unknown>)
            : {},
      };
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error("Failed to initialize MCP module.");
}

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

  try {
    const headers = normalizeHeaders(parsed.data.headers || {});
    const initialized = await initializeMcp({
      endpointUrl: parsed.data.endpointUrl,
      headers,
      signal: request.signal,
    });

    let toolCount = 0;
    let sampleTools: string[] = [];
    try {
      const listResult = (await sendRpcRequest({
        endpointUrl: parsed.data.endpointUrl,
        headers,
        method: "tools/list",
        params: {},
        signal: request.signal,
      })) as
        | {
            tools?: Array<{
              name?: unknown;
            }>;
          }
        | undefined;
      const tools = Array.isArray(listResult?.tools) ? listResult.tools : [];
      const normalizedNames = tools
        .map((item) => (typeof item?.name === "string" ? item.name.trim() : ""))
        .filter(Boolean);
      toolCount = normalizedNames.length;
      sampleTools = normalizedNames.slice(0, 5);
    } catch {
      // tools/list is optional; initialize success is enough for connection check.
    }

    return Response.json({
      ok: true,
      message: "MCP 连接成功。",
      protocolVersion: initialized.protocolVersion,
      serverInfo: {
        name: String(initialized.serverInfo?.name || ""),
        version: String(initialized.serverInfo?.version || ""),
      },
      toolCount,
      sampleTools,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "MCP 连接测试失败。";
    return Response.json({ error: message }, { status: 502 });
  }
}
