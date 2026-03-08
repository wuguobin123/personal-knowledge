/**
 * MCP Runtime - 基于 @modelcontextprotocol/sdk 的实现
 * 保持原有 API 接口不变，替换底层通信层
 */

import { listEnabledQaMcpModules, type QaMcpModule } from "@/lib/qa/mcp-modules";
import { tryAutoRunMcpTool as tryAutoRunMcpToolNew, type McpExecutionResult } from "@/lib/mcp/runtime";
import type { QaMessage, QaMode } from "@/lib/qa/multi-agent";

// 重新导出 ExecutionResult 类型以保持兼容性
export type { McpExecutionResult as QaMcpExecutionResult } from "@/lib/mcp/runtime";

export type { McpExecutionResult };

/**
 * 尝试自动运行 MCP 工具（兼容原有接口）
 * 底层使用新的 SDK 实现
 */
export async function tryAutoRunQaMcpTool(input: {
  messages: QaMessage[];
  mode: QaMode;
  signal?: AbortSignal;
  attachmentFileNames?: string[];
}): Promise<McpExecutionResult> {
  console.log(`[qa:mcp-runtime] tryAutoRunQaMcpTool called: mode=${input.mode}`);
  
  // 获取启用的模块
  const modules = await listEnabledQaMcpModules();
  console.log(`[qa:mcp-runtime] Loaded ${modules.length} enabled modules from DB: ${modules.map(m => m.moduleKey).join(', ') || '(none)'}`);
  
  if (modules.length === 0) {
    console.log(`[qa:mcp-runtime] No enabled MCP modules found`);
    return { used: false, reason: "No enabled MCP modules" };
  }
  
  // 转换为新模块格式
  const convertedModules = modules.map(convertToNewModule);
  
  // 调用新的实现
  return tryAutoRunMcpToolNew({
    messages: input.messages,
    mode: input.mode,
    signal: input.signal,
    attachmentFileNames: input.attachmentFileNames,
    modules: convertedModules,
  });
}

/**
 * 将旧模块格式转换为新格式
 */
function convertToNewModule(module: QaMcpModule) {
  return {
    id: module.id,
    moduleKey: module.moduleKey,
    label: module.label,
    description: module.description,
    transport: module.transport,
    endpointUrl: module.endpointUrl,
    headers: module.headers,
    connectionConfig: module.connectionConfig,
    keywordHints: module.keywordHints,
    toolAllowlist: module.toolAllowlist,
    modeHint: module.modeHint,
    isEnabled: module.isEnabled,
    createdAt: module.createdAt,
    updatedAt: module.updatedAt,
  };
}

// 导出新的连接管理器功能（可选使用）
export {
  getGlobalConnectionManager,
  resetGlobalConnectionManager,
} from "@/lib/mcp/runtime";
