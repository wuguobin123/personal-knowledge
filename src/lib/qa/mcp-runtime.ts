import { StringOutputParser } from "@langchain/core/output_parsers";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { ChatOpenAI } from "@langchain/openai";
import { listEnabledQaMcpModules, type QaMcpModule } from "@/lib/qa/mcp-modules";
import type { QaMessage, QaMode } from "@/lib/qa/multi-agent";

type QaMcpToolDescriptor = {
  module: QaMcpModule;
  name: string;
  description: string;
  inputSchema: unknown;
};

type QaMcpToolChoice = {
  action: "skip" | "use_tool";
  toolRef: string;
  arguments: Record<string, unknown>;
  reason: string;
};

export type QaMcpExecutionResult = {
  used: boolean;
  moduleKey?: string;
  moduleLabel?: string;
  toolName?: string;
  reason?: string;
  error?: string;
  contextMessage?: QaMessage;
};

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: number;
  method: string;
  params?: unknown;
};

type JsonRpcResponse = {
  jsonrpc?: "2.0";
  id?: number;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
};

const DEFAULT_BASE_URL = "https://api.siliconflow.cn/v1";
const DEFAULT_MODEL = "deepseek-ai/DeepSeek-R1-Distill-Qwen-32B";
const DEFAULT_MCP_TIMEOUT_MS = 25000;
const MAX_MCP_RESULT_CHARS = 5000;
const MCP_TOOL_CACHE_TTL_MS = 60 * 1000;
const moduleToolsCache = new Map<string, { expiresAt: number; tools: QaMcpToolDescriptor[] }>();

function getSiliconFlowApiKey() {
  const apiKey = String(process.env.SILICONFLOW_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("SILICONFLOW_API_KEY is missing.");
  }
  return apiKey;
}

function getSiliconFlowModel() {
  return String(process.env.SILICONFLOW_MODEL || DEFAULT_MODEL).trim();
}

function getSiliconFlowBaseUrl() {
  return String(process.env.SILICONFLOW_BASE_URL || DEFAULT_BASE_URL).trim();
}

function createLlm(temperature: number) {
  return new ChatOpenAI({
    apiKey: getSiliconFlowApiKey(),
    model: getSiliconFlowModel(),
    temperature,
    configuration: {
      baseURL: getSiliconFlowBaseUrl(),
    },
  });
}

function getMcpTimeoutMs() {
  const raw = Number(process.env.QA_MCP_TIMEOUT_MS || DEFAULT_MCP_TIMEOUT_MS);
  if (!Number.isFinite(raw)) {
    return DEFAULT_MCP_TIMEOUT_MS;
  }
  return Math.max(5000, Math.floor(raw));
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

function normalizeArgs(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }
  return value as Record<string, unknown>;
}

function parseChoice(raw: string): QaMcpToolChoice {
  const parsed = parseJsonObjectFromText(raw) || {};
  const action = parsed.action === "use_tool" ? "use_tool" : "skip";
  const toolRef = typeof parsed.toolRef === "string" ? parsed.toolRef.trim() : "";
  const reason = typeof parsed.reason === "string" ? parsed.reason.trim() : "";
  const args = normalizeArgs(parsed.arguments);
  return {
    action,
    toolRef,
    reason,
    arguments: args,
  };
}

function toTerms(query: string) {
  const normalized = query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
  return Array.from(new Set(normalized)).slice(0, 24);
}

function latestUserQuestion(messages: QaMessage[]) {
  const latest = [...messages].reverse().find((item) => item.role === "user");
  return latest?.content?.trim() || "";
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
      // Try next chunk
    }
  }

  const fallback = parseJsonObjectFromText(rawText);
  if (fallback) {
    return normalizeRpcEnvelope(fallback);
  }

  throw new Error(`MCP returned unsupported response: ${rawText.slice(0, 260)}`);
}

async function postJsonRpc(input: {
  module: QaMcpModule;
  request: JsonRpcRequest;
  signal?: AbortSignal;
}) {
  const timeoutMs = getMcpTimeoutMs();
  const { signal, cleanup } = createRpcAbortController(timeoutMs, input.signal);

  try {
    const response = await fetch(input.module.endpointUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...input.module.headers,
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
  module: QaMcpModule;
  method: string;
  params?: unknown;
  signal?: AbortSignal;
}) {
  const response = await postJsonRpc({
    module: input.module,
    request: {
      jsonrpc: "2.0",
      id: Date.now(),
      method: input.method,
      params: input.params,
    },
    signal: input.signal,
  });

  if (response.error) {
    const message = String(response.error.message || "Unknown JSON-RPC error.");
    throw new Error(`${input.method} failed: ${message}`);
  }

  return response.result;
}

async function sendRpcNotification(input: {
  module: QaMcpModule;
  method: string;
  params?: unknown;
  signal?: AbortSignal;
}) {
  await postJsonRpc({
    module: input.module,
    request: {
      jsonrpc: "2.0",
      method: input.method,
      params: input.params,
    },
    signal: input.signal,
  });
}

async function initializeModule(module: QaMcpModule, signal?: AbortSignal) {
  const protocolVersions = ["2025-03-26", "2024-11-05"];
  let lastError: unknown;

  for (const protocolVersion of protocolVersions) {
    try {
      await sendRpcRequest({
        module,
        method: "initialize",
        params: {
          protocolVersion,
          capabilities: {},
          clientInfo: {
            name: "personal-knowledge-qa",
            version: "0.1.0",
          },
        },
        signal,
      });

      try {
        await sendRpcNotification({
          module,
          method: "notifications/initialized",
          params: {},
          signal,
        });
      } catch {
        // Ignore notification failure; many servers do not require it.
      }

      return;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error("Failed to initialize MCP module.");
}

function normalizeToolDescription(value: unknown) {
  if (typeof value === "string" && value.trim()) {
    return value.trim().slice(0, 400);
  }
  return "No description";
}

function moduleMatchesMode(module: QaMcpModule, mode: QaMode) {
  if (module.modeHint === "auto" || mode === "auto") {
    return true;
  }
  return module.modeHint === mode;
}

function scoreTool(tool: QaMcpToolDescriptor, terms: string[]) {
  if (terms.length === 0) return 0;

  const haystack = [
    tool.module.label,
    tool.module.description,
    tool.module.keywordHints.join(" "),
    tool.name,
    tool.description,
  ]
    .join(" ")
    .toLowerCase();

  let score = 0;
  for (const term of terms) {
    if (!haystack.includes(term)) continue;
    score += 1;
    if (tool.name.toLowerCase().includes(term)) score += 2;
    if (tool.module.keywordHints.some((hint) => hint.toLowerCase().includes(term))) score += 2;
  }

  return score;
}

function serializeSchemaForPrompt(value: unknown) {
  try {
    const text = JSON.stringify(value ?? {}, null, 2);
    return text.length <= 800 ? text : `${text.slice(0, 780)}...`;
  } catch {
    return "{}";
  }
}

async function listToolsForModule(module: QaMcpModule, signal?: AbortSignal) {
  const cached = moduleToolsCache.get(module.moduleKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.tools;
  }

  await initializeModule(module, signal);

  const collected: QaMcpToolDescriptor[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < 4; page += 1) {
    const result = (await sendRpcRequest({
      module,
      method: "tools/list",
      params: cursor ? { cursor } : {},
      signal,
    })) as
      | {
          tools?: Array<{
            name?: unknown;
            description?: unknown;
            inputSchema?: unknown;
          }>;
          nextCursor?: unknown;
        }
      | undefined;

    const tools = Array.isArray(result?.tools) ? result.tools : [];
    for (const tool of tools) {
      const name = typeof tool.name === "string" ? tool.name.trim() : "";
      if (!name) continue;
      if (module.toolAllowlist.length > 0 && !module.toolAllowlist.includes(name)) {
        continue;
      }

      collected.push({
        module,
        name,
        description: normalizeToolDescription(tool.description),
        inputSchema: tool.inputSchema ?? {},
      });
    }

    if (typeof result?.nextCursor !== "string" || !result.nextCursor.trim()) {
      break;
    }
    cursor = result.nextCursor.trim();
  }

  moduleToolsCache.set(module.moduleKey, {
    expiresAt: Date.now() + MCP_TOOL_CACHE_TTL_MS,
    tools: collected,
  });
  return collected;
}

function heuristicChoice(input: { tools: QaMcpToolDescriptor[]; question: string }) {
  const terms = toTerms(input.question);
  const ranked = input.tools
    .map((tool) => ({
      tool,
      score: scoreTool(tool, terms),
    }))
    .sort((a, b) => b.score - a.score);

  if (!ranked[0] || ranked[0].score < 2) {
    return null;
  }

  return {
    action: "use_tool" as const,
    toolRef: `${ranked[0].tool.module.moduleKey}::${ranked[0].tool.name}`,
    arguments: {
      query: input.question,
    },
    reason: "Heuristic fallback based on keyword match.",
  };
}

async function chooseToolWithLlm(input: {
  tools: QaMcpToolDescriptor[];
  messages: QaMessage[];
  mode: QaMode;
  signal?: AbortSignal;
}) {
  const question = latestUserQuestion(input.messages);
  const conversation = input.messages.map((item) => `[${item.role}] ${item.content}`).join("\n");
  const compactTools = input.tools.slice(0, 24).map((item) => ({
    toolRef: `${item.module.moduleKey}::${item.name}`,
    moduleLabel: item.module.label,
    moduleDescription: item.module.description,
    toolName: item.name,
    toolDescription: item.description,
    inputSchema: serializeSchemaForPrompt(item.inputSchema),
  }));

  const prompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      [
        "You are an MCP tool router for a Q&A assistant.",
        "Decide whether to call exactly one tool.",
        "Only call a tool when external execution is clearly useful.",
        "Return strict JSON only:",
        "{\"action\":\"skip|use_tool\",\"toolRef\":\"moduleKey::toolName\",\"arguments\":{},\"reason\":\"...\"}",
        "If action=skip, toolRef must be empty string and arguments must be {}.",
      ].join("\n"),
    ],
    [
      "human",
      [
        `Mode: ${input.mode}`,
        "Conversation:",
        conversation.slice(-5000),
        "Latest user question:",
        question,
        "Available tools:",
        JSON.stringify(compactTools, null, 2),
      ].join("\n"),
    ],
  ]);

  const llm = createLlm(0);
  const parser = new StringOutputParser();
  const chain = prompt.pipe(llm).pipe(parser);
  const raw = await chain.invoke(
    {},
    {
      signal: input.signal,
    },
  );
  return parseChoice(raw);
}

function normalizeToolResult(result: unknown) {
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const payload = result as {
      content?: unknown;
      structuredContent?: unknown;
      isError?: unknown;
    };

    if (Array.isArray(payload.content)) {
      const textParts = payload.content
        .map((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) {
            return "";
          }
          const contentItem = item as { type?: unknown; text?: unknown };
          if (contentItem.type === "text" && typeof contentItem.text === "string") {
            return contentItem.text;
          }
          return "";
        })
        .filter(Boolean);

      if (textParts.length > 0) {
        return textParts.join("\n").slice(0, MAX_MCP_RESULT_CHARS);
      }
    }

    if (payload.structuredContent !== undefined) {
      try {
        return JSON.stringify(payload.structuredContent, null, 2).slice(0, MAX_MCP_RESULT_CHARS);
      } catch {
        // fall through
      }
    }
  }

  try {
    return JSON.stringify(result, null, 2).slice(0, MAX_MCP_RESULT_CHARS);
  } catch {
    return String(result || "").slice(0, MAX_MCP_RESULT_CHARS);
  }
}

function buildMcpContextMessage(input: {
  tool: QaMcpToolDescriptor;
  reason: string;
  args: Record<string, unknown>;
  resultText: string;
}) {
  const argsText = JSON.stringify(input.args, null, 2);
  const content = [
    "[MCP Tool Execution]",
    `Module: ${input.tool.module.label} (${input.tool.module.moduleKey})`,
    `Tool: ${input.tool.name}`,
    `Reason: ${input.reason || "Auto selected by MCP router."}`,
    "Arguments:",
    argsText,
    "Result:",
    input.resultText,
    "",
    "请优先基于以上 MCP 结果回答用户问题，并明确说明任何不确定性。",
  ].join("\n");

  return {
    role: "assistant" as const,
    content,
  };
}

export async function tryAutoRunQaMcpTool(input: {
  messages: QaMessage[];
  mode: QaMode;
  signal?: AbortSignal;
}): Promise<QaMcpExecutionResult> {
  const question = latestUserQuestion(input.messages);
  if (!question) {
    return { used: false };
  }

  const enabledModules = await listEnabledQaMcpModules();
  const candidateModules = enabledModules.filter((module) => moduleMatchesMode(module, input.mode));
  if (candidateModules.length === 0) {
    return { used: false };
  }

  const discoveredTools: QaMcpToolDescriptor[] = [];
  for (const module of candidateModules) {
    try {
      const tools = await listToolsForModule(module, input.signal);
      discoveredTools.push(...tools);
    } catch {
      // Skip broken module for current request to keep Q&A available.
    }
  }

  if (discoveredTools.length === 0) {
    return { used: false };
  }

  let choice: QaMcpToolChoice;
  try {
    choice = await chooseToolWithLlm({
      tools: discoveredTools,
      messages: input.messages,
      mode: input.mode,
      signal: input.signal,
    });
  } catch {
    const heuristic = heuristicChoice({ tools: discoveredTools, question });
    if (!heuristic) {
      return { used: false };
    }
    choice = heuristic;
  }

  if (choice.action !== "use_tool" || !choice.toolRef) {
    return { used: false, reason: choice.reason || "Router decided to skip MCP tools." };
  }

  const selectedTool = discoveredTools.find(
    (item) => `${item.module.moduleKey}::${item.name}` === choice.toolRef,
  );
  if (!selectedTool) {
    return { used: false, reason: "Router selected an unavailable MCP tool." };
  }

  try {
    const result = await sendRpcRequest({
      module: selectedTool.module,
      method: "tools/call",
      params: {
        name: selectedTool.name,
        arguments: choice.arguments,
      },
      signal: input.signal,
    });

    const resultText = normalizeToolResult(result);
    return {
      used: true,
      moduleKey: selectedTool.module.moduleKey,
      moduleLabel: selectedTool.module.label,
      toolName: selectedTool.name,
      reason: choice.reason,
      contextMessage: buildMcpContextMessage({
        tool: selectedTool,
        reason: choice.reason,
        args: choice.arguments,
        resultText,
      }),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown MCP error.";
    return {
      used: false,
      moduleKey: selectedTool.module.moduleKey,
      moduleLabel: selectedTool.module.label,
      toolName: selectedTool.name,
      reason: choice.reason,
      error: `MCP tool execution failed: ${message}`,
    };
  }
}
