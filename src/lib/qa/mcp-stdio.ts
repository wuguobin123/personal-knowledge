import { spawn } from "node:child_process";

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: number | string;
  method: string;
  params?: unknown;
};

export type JsonRpcResponse = {
  jsonrpc?: "2.0";
  id?: number | string;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
};

export type McpStdioConfig = {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
};

function frameJsonRpcMessage(payload: JsonRpcRequest) {
  const body = JSON.stringify(payload);
  const byteLength = Buffer.byteLength(body, "utf8");
  return `Content-Length: ${byteLength}\r\n\r\n${body}`;
}

function normalizeRpcEnvelope(payload: unknown): JsonRpcResponse {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { result: payload };
  }

  const envelope = payload as Record<string, unknown>;
  if ("result" in envelope || "error" in envelope || "jsonrpc" in envelope || "id" in envelope) {
    return envelope as JsonRpcResponse;
  }

  return { result: envelope };
}

export function parseMcpStdioConfig(value: unknown): McpStdioConfig | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const payload = value as Record<string, unknown>;
  const command = typeof payload.command === "string" ? payload.command.trim() : "";
  if (!command) return null;

  const args = Array.isArray(payload.args)
    ? payload.args
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 80)
    : [];

  const env =
    payload.env && typeof payload.env === "object" && !Array.isArray(payload.env)
      ? Object.entries(payload.env as Record<string, unknown>).reduce<Record<string, string>>(
          (acc, [key, rawValue]) => {
            const envKey = String(key || "").trim();
            if (!envKey) return acc;
            if (typeof rawValue !== "string" && typeof rawValue !== "number" && typeof rawValue !== "boolean") {
              return acc;
            }
            acc[envKey] = String(rawValue);
            return acc;
          },
          {},
        )
      : {};

  const cwd = typeof payload.cwd === "string" && payload.cwd.trim() ? payload.cwd.trim() : undefined;
  return { command, args, env, cwd };
}

export async function postJsonRpcViaStdio(input: {
  config: McpStdioConfig;
  request: JsonRpcRequest;
  signal?: AbortSignal;
  timeoutMs: number;
  autoInitialize?: boolean;
}) {
  const shouldAutoInitialize =
    Boolean(input.autoInitialize) &&
    input.request.method !== "initialize" &&
    input.request.method !== "notifications/initialized";

  const initRequest: JsonRpcRequest | null = shouldAutoInitialize
    ? {
        jsonrpc: "2.0",
        id: -1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: {
            name: "personal-knowledge-qa",
            version: "0.1.0",
          },
        },
      }
    : null;
  const initializedNotification: JsonRpcRequest | null = shouldAutoInitialize
    ? {
        jsonrpc: "2.0",
        method: "notifications/initialized",
        params: {},
      }
    : null;
  const requests: JsonRpcRequest[] = [
    ...(initRequest ? [initRequest] : []),
    ...(initializedNotification ? [initializedNotification] : []),
    input.request,
  ];

  const targetId = input.request.id;
  const expectResponse = targetId !== undefined;
  const stdioEnv = { ...process.env, ...input.config.env };

  return await new Promise<JsonRpcResponse>((resolve, reject) => {
    const child = spawn(input.config.command, input.config.args, {
      cwd: input.config.cwd,
      env: stdioEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let settled = false;
    let timer: NodeJS.Timeout | null = null;
    let stderrText = "";
    let stdoutBuffer = Buffer.alloc(0);

    const clearResources = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      child.removeAllListeners();
      child.stdout?.removeAllListeners();
      child.stderr?.removeAllListeners();
    };

    const finalize = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearResources();
      try {
        child.kill("SIGTERM");
      } catch {
        // ignore
      }
      fn();
    };

    const fail = (message: string) => {
      const detail = stderrText.trim() ? ` | stderr: ${stderrText.trim().slice(0, 600)}` : "";
      finalize(() => reject(new Error(`${message}${detail}`)));
    };

    const succeed = (payload: JsonRpcResponse) => {
      finalize(() => resolve(payload));
    };

    const tryParseMessages = () => {
      while (true) {
        const headerEndIndex = stdoutBuffer.indexOf("\r\n\r\n");
        if (headerEndIndex < 0) break;

        const headerText = stdoutBuffer.slice(0, headerEndIndex).toString("utf8");
        const contentLengthMatch = headerText.match(/content-length:\s*(\d+)/i);
        if (!contentLengthMatch) {
          fail(`MCP stdio response missing Content-Length header: ${headerText.slice(0, 200)}`);
          return;
        }

        const contentLength = Number(contentLengthMatch[1]);
        if (!Number.isFinite(contentLength) || contentLength < 0) {
          fail(`MCP stdio invalid Content-Length: ${contentLengthMatch[1]}`);
          return;
        }

        const messageStart = headerEndIndex + 4;
        const messageEnd = messageStart + contentLength;
        if (stdoutBuffer.length < messageEnd) break;

        const messageText = stdoutBuffer.slice(messageStart, messageEnd).toString("utf8");
        stdoutBuffer = stdoutBuffer.slice(messageEnd);

        try {
          const parsed = normalizeRpcEnvelope(JSON.parse(messageText));
          if (!expectResponse) {
            continue;
          }
          if (parsed.id === targetId) {
            succeed(parsed);
            return;
          }
        } catch {
          fail(`MCP stdio returned invalid JSON: ${messageText.slice(0, 260)}`);
          return;
        }
      }
    };

    timer = setTimeout(() => {
      fail("MCP stdio request timeout.");
    }, input.timeoutMs);

    if (input.signal) {
      if (input.signal.aborted) {
        fail(`MCP stdio aborted: ${String(input.signal.reason || "aborted")}`);
        return;
      }
      input.signal.addEventListener(
        "abort",
        () => {
          fail(`MCP stdio aborted: ${String(input.signal?.reason || "aborted")}`);
        },
        { once: true },
      );
    }

    child.on("error", (error) => {
      fail(`Failed to start MCP stdio process: ${error.message}`);
    });

    child.on("exit", (code, signal) => {
      if (settled) return;
      tryParseMessages();
      if (settled) return;
      if (!expectResponse) {
        succeed({});
        return;
      }
      fail(`MCP stdio process exited before response (code=${String(code)}, signal=${String(signal)})`);
    });

    child.stderr?.on("data", (chunk: Buffer | string) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      stderrText = `${stderrText}${text}`.slice(-4000);
    });

    child.stdout?.on("data", (chunk: Buffer | string) => {
      if (settled) return;
      const raw = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
      stdoutBuffer = Buffer.concat([stdoutBuffer, raw]);
      tryParseMessages();
    });

    const payload = requests.map(frameJsonRpcMessage).join("");
    if (!child.stdin) {
      fail("MCP stdio process stdin is unavailable.");
      return;
    }
    child.stdin.write(payload, "utf8", (error) => {
      if (error) {
        fail(`Failed to write MCP stdio request: ${error.message}`);
        return;
      }
      // Keep stdin open while waiting for response. Some MCP servers exit on EOF.
      if (!expectResponse) {
        child.stdin?.end();
        setTimeout(() => {
          if (!settled) {
            succeed({});
          }
        }, 30);
      }
    });
  });
}
