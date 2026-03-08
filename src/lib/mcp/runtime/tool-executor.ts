/**
 * MCP Tool Executor - 工具执行器
 * 保留原有业务逻辑：LLM 路由、工具选择、结果处理
 */

import { ChatOpenAI } from "@langchain/openai";
import { getGlobalConnectionManager } from "./connection-manager";
import type { McpModule, McpTool } from "../types";

// Q&A 类型定义（从原有系统导入）
import type { QaMessage, QaMode } from "@/lib/qa/multi-agent";

// 从原 mcp-runtime.ts 导入的常量
const DEFAULT_BASE_URL = "https://api.siliconflow.cn/v1";
const DEFAULT_MODEL = "deepseek-ai/DeepSeek-R1-Distill-Qwen-32B";
const MAX_MCP_RESULT_CHARS = 5000;

type ToolDescriptor = {
  module: McpModule;
  name: string;
  description: string;
  inputSchema: unknown;
};

type ToolChoice = {
  action: "skip" | "use_tool";
  toolRef: string;
  arguments: Record<string, unknown>;
  reason: string;
};

export type McpExecutionResult = {
  used: boolean;
  moduleKey?: string;
  moduleLabel?: string;
  toolName?: string;
  reason?: string;
  error?: string;
  contextMessage?: QaMessage;
};

// LLM 相关函数
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

function parseJsonObjectFromText(raw: string): Record<string, unknown> | null {
  const cleaned = String(raw || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  
  // 使用平衡括号算法找到最外层的 JSON 对象
  let braceCount = 0;
  let startIndex = -1;
  
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] === '{') {
      if (braceCount === 0) {
        startIndex = i;
      }
      braceCount++;
    } else if (cleaned[i] === '}') {
      braceCount--;
      if (braceCount === 0 && startIndex !== -1) {
        // 找到完整的 JSON 对象
        const jsonStr = cleaned.slice(startIndex, i + 1);
        try {
          const parsed = JSON.parse(jsonStr) as unknown;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
          }
        } catch {
          // 继续寻找下一个可能的 JSON 对象
          startIndex = -1;
        }
      }
    }
  }
  
  // 如果平衡括号算法失败，尝试简单的正则匹配作为后备
  const matched = cleaned.match(/\{[\s\S]*\}/);
  if (matched) {
    try {
      const parsed = JSON.parse(matched[0]) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // 解析失败
    }
  }
  
  return null;
}

function normalizeArgs(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }
  return value as Record<string, unknown>;
}

function parseChoice(raw: string): ToolChoice | null {
  // 记录原始响应用于调试
  console.log(`[qa:mcp:debug] Raw LLM response (${raw.length} chars):`, raw.slice(0, 500));
  
  const parsed = parseJsonObjectFromText(raw);
  if (!parsed) {
    console.warn(`[qa:mcp:debug] Failed to parse JSON from response:`, raw.slice(0, 500));
    return null;
  }
  
  const action = parsed.action === "use_tool" ? "use_tool" : "skip";
  const toolRef = typeof parsed.toolRef === "string" ? parsed.toolRef.trim() : "";
  const reason = typeof parsed.reason === "string" ? parsed.reason.trim() : "";
  const args = normalizeArgs(parsed.arguments);
  
  console.log(`[qa:mcp:debug] Parsed choice: action=${action}, toolRef=${toolRef || "(empty)"}`);
  
  return {
    action,
    toolRef,
    reason,
    arguments: args,
  };
}

function latestUserQuestion(messages: QaMessage[]) {
  const latest = [...messages].reverse().find((item) => item.role === "user");
  return latest?.content?.trim() || "";
}

function moduleMatchesMode(module: McpModule, mode: QaMode) {
  if (module.modeHint === "auto" || mode === "auto") {
    return true;
  }
  return module.modeHint === mode;
}

function serializeSchemaForPrompt(value: unknown) {
  try {
    const text = JSON.stringify(value ?? {}, null, 2);
    return text.length <= 800 ? text : `${text.slice(0, 780)}...`;
  } catch {
    return "{}";
  }
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
  tool: ToolDescriptor;
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

// 主要执行函数
export async function tryAutoRunMcpTool(input: {
  messages: QaMessage[];
  mode: QaMode;
  signal?: AbortSignal;
  attachmentFileNames?: string[];
  modules: McpModule[];
}): Promise<McpExecutionResult> {
  const question = latestUserQuestion(input.messages);
  console.log(`[qa:mcp:entry] Called with mode=${input.mode}, modules=${input.modules.length}, attachments=${input.attachmentFileNames?.length || 0}`);
  
  if (!question) {
    console.log(`[qa:mcp:entry] No user question found, skipping MCP`);
    return { used: false };
  }
  console.log(`[qa:mcp:entry] User question: "${question.slice(0, 100)}..."`);

  const manager = getGlobalConnectionManager();
  
  // 过滤符合模式的模块
  const candidateModules = input.modules.filter((module) => 
    module.isEnabled && moduleMatchesMode(module, input.mode)
  );
  
  console.log(`[qa:mcp:filter] Total modules: ${input.modules.length}, Candidates after mode filter (${input.mode}): ${candidateModules.length}`);
  if (candidateModules.length > 0) {
    console.log(`[qa:mcp:filter] Candidate modules: ${candidateModules.map(m => `${m.moduleKey}(modeHint=${m.modeHint})`).join(', ')}`);
  } else {
    console.log(`[qa:mcp:filter] No modules match mode=${input.mode}. All modules: ${input.modules.map(m => `${m.moduleKey}(modeHint=${m.modeHint},enabled=${m.isEnabled})`).join(', ')}`);
    return { used: false };
  }

  // 注册模块到连接管理器
  manager.registerModules(candidateModules);

  // 发现工具
  const discoveredTools: ToolDescriptor[] = [];
  const toolDiscoveryErrors: string[] = [];
  
  console.log(`[qa:mcp:discovery] Starting tool discovery for ${candidateModules.length} modules...`);
  console.log(`[qa:mcp:discovery] Candidate modules: ${candidateModules.map(m => `${m.moduleKey}(${m.transport})`).join(', ')}`);
  
  for (const module of candidateModules) {
    console.log(`[qa:mcp:discovery] --- Processing ${module.moduleKey} (${module.transport}) ---`);
    console.log(`[qa:mcp:discovery] Checking if client is registered...`);
    
    const isRegistered = manager.isRegistered(module.moduleKey);
    const isConnected = manager.isConnected(module.moduleKey);
    console.log(`[qa:mcp:discovery] ${module.moduleKey}: registered=${isRegistered}, connected=${isConnected}`);
    
    try {
      console.log(`[qa:mcp:discovery] Calling listTools for ${module.moduleKey}...`);
      const tools = await manager.listTools(module.moduleKey);
      console.log(`[qa:mcp:discovery] ✓ ${module.moduleKey}: discovered ${tools.length} tools`);
      if (tools.length > 0) {
        console.log(`[qa:mcp:discovery]   Tools: ${tools.map(t => t.name).join(', ')}`);
      }
      discoveredTools.push(...tools.map(tool => ({
        module,
        name: tool.name,
        description: tool.description || "No description",
        inputSchema: tool.inputSchema,
      })));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown tool discovery error.";
      toolDiscoveryErrors.push(`${module.moduleKey}: ${message}`);
      console.error(`[qa:mcp:discovery] ✗ ${module.moduleKey}: ${message}`);
      if (error instanceof Error && error.stack) {
        console.error(`[qa:mcp:discovery] Stack: ${error.stack}`);
      }
    }
  }

  console.log(`[qa:mcp:discovery] Summary: ${discoveredTools.length} tools discovered, ${toolDiscoveryErrors.length} errors`);
  if (toolDiscoveryErrors.length > 0) {
    console.error(`[qa:mcp:discovery] Errors:\n${toolDiscoveryErrors.join('\n')}`);
  }

  if (discoveredTools.length === 0) {
    console.error(`[qa:mcp:discovery] No tools discovered. Errors: ${toolDiscoveryErrors.join(" | ")}`);
    if (toolDiscoveryErrors.length > 0) {
      return {
        used: false,
        reason: `No MCP tools discovered. ${toolDiscoveryErrors.join(" | ").slice(0, 360)}`,
      };
    }
    return { used: false };
  }

  // 使用 LLM 选择工具（带重试）
  let choice: ToolChoice | undefined;
  let routerError = "";
  let lastRawResponse = "";
  const maxRetries = 3;
  
  console.log(`[qa:mcp] Starting LLM routing with ${discoveredTools.length} tools, question: "${question.slice(0, 100)}..."`);
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`[qa:mcp] Retry attempt ${attempt + 1}/${maxRetries}...`);
      }
      
      const result = await chooseToolWithLlm({
        tools: discoveredTools,
        messages: input.messages,
        mode: input.mode,
        signal: input.signal,
        attachmentFileNames: input.attachmentFileNames,
        previousError: attempt > 0 ? `Previous response was not valid JSON. Please return ONLY a JSON object.` : undefined,
      });
      choice = result;
      console.log(`[qa:mcp] LLM routing succeeded on attempt ${attempt + 1}`);
      break; // 成功，跳出重试循环
    } catch (error) {
      routerError = error instanceof Error ? error.message : "Unknown router error.";
      lastRawResponse = (error as Error).cause as string || "";
      console.warn(`[qa:mcp] LLM router attempt ${attempt + 1}/${maxRetries} failed: ${routerError}`);
      console.warn(`[qa:mcp] Failed response preview:`, lastRawResponse.slice(0, 300));
      
      if (attempt === maxRetries - 1) {
        // 最后一次尝试失败
        console.error(`[qa:mcp] All ${maxRetries} attempts failed. Last error: ${routerError}`);
        return {
          used: false,
          reason: `LLM router failed after ${maxRetries} attempts. ${routerError.slice(0, 300)}`,
        };
      }
      // 继续重试
    }
  }

  if (!choice || choice.action !== "use_tool" || !choice.toolRef) {
    console.log(`[qa:mcp:router] LLM decided to skip MCP tools. action=${choice?.action}, reason=${choice?.reason || "(none)"}`);
    return { used: false, reason: choice?.reason || "Router decided to skip MCP tools." };
  }
  
  console.log(`[qa:mcp:router] LLM selected tool: ${choice.toolRef}, args=${JSON.stringify(choice.arguments).slice(0, 200)}`);

  // 解析 toolRef: "moduleKey::toolName"
  const [moduleKey, toolName] = choice.toolRef.split("::");
  console.log(`[qa:mcp:router] Parsed moduleKey=${moduleKey}, toolName=${toolName}`);
  
  const selectedTool = discoveredTools.find(
    (item) => item.module.moduleKey === moduleKey && item.name === toolName
  );
  
  if (!selectedTool) {
    console.error(`[qa:mcp:router] Tool not found in discovered tools. Available: ${discoveredTools.map(t => `${t.module.moduleKey}::${t.name}`).join(', ')}`);
    return { used: false, reason: "Router selected an unavailable MCP tool." };
  }
  console.log(`[qa:mcp:router] Tool found: ${selectedTool.module.label}::${selectedTool.name}`);

  // 执行工具
  console.log(`[qa:mcp:execute] Calling tool ${moduleKey}::${toolName}...`);
  try {
    const result = await manager.callTool(moduleKey, toolName, choice.arguments);
    const resultText = normalizeToolResult(result);
    console.log(`[qa:mcp:execute] ✓ Tool executed successfully. Result length: ${resultText.length} chars`);
    
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
    console.error(`[qa:mcp:execute] ✗ Tool execution failed: ${message}`);
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

// LLM 工具选择
async function chooseToolWithLlm(input: {
  tools: ToolDescriptor[];
  messages: QaMessage[];
  mode: QaMode;
  signal?: AbortSignal;
  attachmentFileNames?: string[];
  previousError?: string;
}): Promise<ToolChoice> {
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

  const attachmentHint =
    input.attachmentFileNames && input.attachmentFileNames.length > 0
      ? [
          "===== ATTACHED FILES =====",
          `Files: ${input.attachmentFileNames.join(", ")}`,
          "",
          "CRITICAL INSTRUCTIONS:",
          "1. The user has uploaded file(s) that need to be analyzed.",
          "2. You MUST use 'action: use_tool' to call a tool that can process these files.",
          "3. Look for tools that mention: Excel, CSV, spreadsheet, table, file analysis, or data processing.",
          "4. If you see ANY tool that can handle files/spreadsheets, you MUST select it.",
          "5. NEVER skip when files are attached - always try to use an appropriate tool.",
          "==========================",
        ].join("\n")
      : "";

  // 注意：避免在提示中使用单个花括号，因为 LangChain 会将其解释为模板变量
  const errorHint = input.previousError 
    ? "\n[ERROR: Previous response was invalid. Please ensure you return ONLY valid JSON without any additional text or markdown.]\n" 
    : "";

  const routerInput = [
    `Mode: ${input.mode}`,
    attachmentHint ? `${attachmentHint}\n` : "",
    errorHint,
    "Conversation:",
    conversation.slice(-5000),
    "Latest user question:",
    question,
    "Available tools:",
    JSON.stringify(compactTools, null, 2),
  ]
    .filter(Boolean)
    .join("\n");

  const systemParts = [
    "You are an MCP tool router for a Q&A assistant.",
    "Decide whether to call exactly one tool.",
  ];
  if (attachmentHint) {
    systemParts.push(
      "",
      "FILE ATTACHMENT POLICY:",
      "- When files are attached, you are REQUIRED to use 'action: use_tool'",
      "- Find and select a tool capable of processing the attached file type",
      "- For Excel/CSV files, select tools related to spreadsheet/data analysis",
      "- Skipping (action: skip) is NOT allowed when files are attached",
      "",
    );
  } else {
    systemParts.push(
      "Only call a tool when external execution is clearly useful.",
    );
  }
  // 直接使用字面量花括号（不再经过 ChatPromptTemplate，避免 "Single '}' in template"）
  systemParts.push(
    "CRITICAL: Your entire response must be a single valid JSON object. Do not include any other text, markdown, or explanation.",
    "Response format:",
    '{"action":"skip|use_tool","toolRef":"moduleKey::toolName","arguments":{},"reason":"..."}',
    "Rules:",
    "- action: use 'use_tool' to call a tool, 'skip' to skip",
    "- toolRef: format is 'moduleKey::toolName', empty string if skipping",
    "- arguments: must be a valid JSON object matching the tool's inputSchema, empty {} if skipping",
    "- reason: brief explanation of your decision",
    "Examples:",
    '{"action":"use_tool","toolRef":"mcp-github-xxx::create_or_update_file","arguments":{"owner":"myuser","repo":"myrepo","path":"README.md","content":"# Hello","message":"Update README","branch":"main"},"reason":"User wants to create a file"}',
    '{"action":"skip","toolRef":"","arguments":{},"reason":"No tool needed for this question"}',
  );

  // 直接构建 messages 调用 LLM，不经过 ChatPromptTemplate，避免 routerInput 中的
  // 用户对话/工具 JSON 里的 { } 被当成模板变量导致 "Single \'}\' in template"
  const messages: Array<{ role: "system" | "user"; content: string }> = [
    { role: "system", content: systemParts.join("\n") },
    { role: "user", content: routerInput },
  ];

  const llm = createLlm(0);
  const response = await llm.invoke(messages, { signal: input.signal });
  const raw =
    typeof response.content === "string"
      ? response.content
      : Array.isArray(response.content)
        ? response.content
            .filter((c): c is { type: "text"; text: string } => c && typeof c === "object" && "text" in c && typeof (c as { text: unknown }).text === "string")
            .map((c) => (c as { text: string }).text)
            .join("")
        : String(response.content ?? "");
  
  const result = parseChoice(raw);
  
  // 如果解析结果为空（无法解析 JSON），抛出错误
  if (!result) {
    throw new Error(`Failed to parse LLM response as JSON: ${raw.slice(0, 200)}`, { cause: raw });
  }
  
  return result;
}
