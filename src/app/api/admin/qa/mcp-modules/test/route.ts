import { z } from "zod";
import { getAdminSession } from "@/lib/auth";
import { parseMcpStdioConfig, postJsonRpcViaStdio } from "@/lib/qa/mcp-stdio";

export const runtime = "nodejs";

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: number;
  method: string;
  params?: unknown;
};

type JsonRpcResponse = {
  id?: number | string;
  result?: unknown;
  error?: {
    message?: string;
  };
};

type QaMcpTransport = "streamable_http" | "sse" | "stdio";

type QaMcpConnectionConfig = {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
};

const testConnectionSchema = z.object({
  transport: z.enum(["streamable_http", "sse", "stdio"]).optional(),
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
    abort(reason?: unknown) {
      controller.abort(reason);
    },
    cleanup() {
      clearTimeout(timer);
    },
  };
}

function resolveSseMessageEndpoint(endpointUrl: string, raw: string) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";

  let candidate = trimmed;
  if (
    (candidate.startsWith('"') && candidate.endsWith('"')) ||
    (candidate.startsWith("'") && candidate.endsWith("'"))
  ) {
    candidate = candidate.slice(1, -1).trim();
  }

  if (candidate.startsWith("{")) {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      const dynamic =
        (typeof parsed.endpoint === "string" && parsed.endpoint) ||
        (typeof parsed.messageUrl === "string" && parsed.messageUrl) ||
        (typeof parsed.url === "string" && parsed.url) ||
        "";
      candidate = dynamic.trim();
    } catch {
      // ignore non-JSON endpoint payload
    }
  }

  if (!candidate) return "";
  try {
    return new URL(candidate, endpointUrl).toString();
  } catch {
    return "";
  }
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
  transport: QaMcpTransport;
  endpointUrl: string;
  headers: Record<string, string>;
  connectionConfig?: QaMcpConnectionConfig;
  request: JsonRpcRequest;
  signal?: AbortSignal;
}) {
  if (input.transport === "stdio") {
    const stdioConfig = parseMcpStdioConfig(input.connectionConfig || {});
    if (!stdioConfig) {
      throw new Error("MCP stdio config is invalid. command is required.");
    }
    return postJsonRpcViaStdio({
      config: stdioConfig,
      request: input.request,
      signal: input.signal,
      timeoutMs: 12000,
      autoInitialize: true,
    });
  }

  if (input.transport === "sse") {
    return postJsonRpcViaSse(input);
  }

  const controller = createRpcAbortController(12000, input.signal);

  try {
    const response = await fetch(input.endpointUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...input.headers,
      },
      body: JSON.stringify(input.request),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 260)}`);
    }

    return await parseRpcResponseBody(response);
  } finally {
    controller.cleanup();
  }
}

async function postToSseMessageEndpoint(input: {
  messageEndpoint: string;
  headers: Record<string, string>;
  request: JsonRpcRequest;
  signal: AbortSignal;
}) {
  const response = await fetch(input.messageEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...input.headers,
    },
    body: JSON.stringify(input.request),
    signal: input.signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 260)}`);
  }
}

async function postJsonRpcViaSse(input: {
  endpointUrl: string;
  headers: Record<string, string>;
  request: JsonRpcRequest;
  signal?: AbortSignal;
}) {
  const controller = createRpcAbortController(12000, input.signal);

  try {
    const sseResponse = await fetch(input.endpointUrl, {
      method: "GET",
      headers: {
        Accept: "text/event-stream",
        ...input.headers,
      },
      signal: controller.signal,
    });

    if (!sseResponse.ok) {
      const text = await sseResponse.text().catch(() => "");
      throw new Error(`HTTP ${sseResponse.status}: ${text.slice(0, 260)}`);
    }

    if (!sseResponse.body) {
      throw new Error("MCP SSE endpoint returned empty response body.");
    }

    const reader = sseResponse.body.getReader();
    const decoder = new TextDecoder();
    const expectedId = input.request.id;
    const expectResponse = expectedId !== undefined;

    let buffer = "";
    let eventName = "";
    let dataLines: string[] = [];
    let messageEndpoint = "";
    let postPromise: Promise<void> | null = null;
    let matchedResponse: JsonRpcResponse | null = null;

    const handleEvent = async () => {
      const currentEvent = eventName.trim();
      const currentData = dataLines.join("\n").trim();
      eventName = "";
      dataLines = [];

      if (!currentData) {
        return false;
      }

      if (
        !messageEndpoint &&
        (currentEvent === "endpoint" || currentEvent === "message-endpoint" || !currentEvent)
      ) {
        const resolved = resolveSseMessageEndpoint(input.endpointUrl, currentData);
        if (resolved) {
          messageEndpoint = resolved;
          postPromise = postToSseMessageEndpoint({
            messageEndpoint,
            headers: input.headers,
            request: input.request,
            signal: controller.signal,
          });
          if (!expectResponse) {
            await postPromise;
            return true;
          }
        }
        return false;
      }

      if (!expectResponse || currentData === "[DONE]") {
        return false;
      }

      try {
        const payload = normalizeRpcEnvelope(JSON.parse(currentData));
        if (payload.id === expectedId) {
          matchedResponse = payload;
          return true;
        }
      } catch {
        // Ignore non-JSON event payloads.
      }
      return false;
    };

    try {
      let completed = false;
      while (!completed) {
        const { done, value } = await reader.read();
        if (done) {
          if (dataLines.length > 0) {
            const shouldStop = await handleEvent();
            if (shouldStop) {
              completed = true;
            }
          }
          if (postPromise) {
            await postPromise;
          }
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        while (true) {
          const newlineIndex = buffer.indexOf("\n");
          if (newlineIndex < 0) break;

          let line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);
          if (line.endsWith("\r")) {
            line = line.slice(0, -1);
          }

          if (!line) {
            const shouldStop = await handleEvent();
            if (shouldStop) {
              completed = true;
              break;
            }
            continue;
          }

          if (line.startsWith(":")) {
            continue;
          }

          if (line.startsWith("event:")) {
            eventName = line.slice(6).trim();
            continue;
          }

          if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trimStart());
          }
        }
      }
    } finally {
      await reader.cancel().catch(() => {});
    }

    if (!messageEndpoint) {
      throw new Error("MCP SSE handshake failed: endpoint event not received.");
    }

    if (postPromise) {
      await postPromise;
    }

    if (!expectResponse) {
      return {} as JsonRpcResponse;
    }

    if (matchedResponse) {
      return matchedResponse;
    }

    throw new Error("MCP SSE did not return a JSON-RPC response for the request id.");
  } finally {
    controller.abort();
    controller.cleanup();
  }
}

async function sendRpcRequest(input: {
  transport: QaMcpTransport;
  endpointUrl: string;
  headers: Record<string, string>;
  connectionConfig?: QaMcpConnectionConfig;
  method: string;
  params?: unknown;
  signal?: AbortSignal;
}) {
  const response = await postJsonRpc({
    transport: input.transport,
    endpointUrl: input.endpointUrl,
    headers: input.headers,
    connectionConfig: input.connectionConfig,
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
  transport: QaMcpTransport;
  endpointUrl: string;
  headers: Record<string, string>;
  connectionConfig?: QaMcpConnectionConfig;
  method: string;
  params?: unknown;
  signal?: AbortSignal;
}) {
  await postJsonRpc({
    transport: input.transport,
    endpointUrl: input.endpointUrl,
    headers: input.headers,
    connectionConfig: input.connectionConfig,
    request: {
      jsonrpc: "2.0",
      method: input.method,
      params: input.params,
    },
    signal: input.signal,
  });
}

async function initializeMcp(input: {
  transport: QaMcpTransport;
  endpointUrl: string;
  headers: Record<string, string>;
  connectionConfig?: QaMcpConnectionConfig;
  signal?: AbortSignal;
}) {
  if (input.transport === "stdio") {
    const stdioConfig = parseMcpStdioConfig(input.connectionConfig || {});
    if (!stdioConfig) {
      throw new Error("MCP stdio config is invalid. command is required.");
    }

    const protocolVersions = ["2025-03-26", "2024-11-05"];
    let lastError: unknown;
    for (const protocolVersion of protocolVersions) {
      try {
        const result = (await postJsonRpcViaStdio({
          config: stdioConfig,
          request: {
            jsonrpc: "2.0",
            id: Date.now(),
            method: "initialize",
            params: {
              protocolVersion,
              capabilities: {},
              clientInfo: {
                name: "personal-knowledge-qa",
                version: "0.1.0",
              },
            },
          },
          signal: input.signal,
          timeoutMs: 12000,
        })) as JsonRpcResponse;

        if (result.error) {
          throw new Error(String(result.error.message || "Unknown error."));
        }
        const payload = (result.result || {}) as Record<string, unknown>;
        return {
          protocolVersion: typeof payload.protocolVersion === "string" ? payload.protocolVersion : protocolVersion,
          serverInfo:
            payload && typeof payload.serverInfo === "object" && payload.serverInfo
              ? (payload.serverInfo as Record<string, unknown>)
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

  const protocolVersions = ["2025-03-26", "2024-11-05"];
  let lastError: unknown;

  for (const protocolVersion of protocolVersions) {
    try {
      const result = (await sendRpcRequest({
        transport: input.transport,
        endpointUrl: input.endpointUrl,
        headers: input.headers,
        connectionConfig: input.connectionConfig,
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
          transport: input.transport,
          endpointUrl: input.endpointUrl,
          headers: input.headers,
          connectionConfig: input.connectionConfig,
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
    const endpointUrlRaw = parsed.data.endpointUrl?.trim() || parsed.data.url?.trim() || "";
    const command = parsed.data.command?.trim() || "";
    const transport = parsed.data.transport || (command ? "stdio" : endpointUrlRaw ? "streamable_http" : undefined);
    const endpointUrl = transport === "stdio" ? "stdio://local" : endpointUrlRaw;
    const normalizedTransport =
      transport === "stdio"
        ? "stdio"
        : endpointUrl.toLowerCase().includes("/sse")
          ? "sse"
          : "streamable_http";
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
    const initialized = await initializeMcp({
      transport: normalizedTransport,
      endpointUrl,
      headers,
      connectionConfig,
      signal: request.signal,
    });

    let toolCount = 0;
    let sampleTools: string[] = [];
    try {
      const listResult = (await sendRpcRequest({
        transport: normalizedTransport,
        endpointUrl,
        headers,
        connectionConfig,
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
