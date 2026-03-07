/**
 * MCP Runtime 模块导出
 */

export {
  McpConnectionManager,
  getGlobalConnectionManager,
  resetGlobalConnectionManager,
} from "./connection-manager";

export {
  tryAutoRunMcpTool,
  type McpExecutionResult,
} from "./tool-executor";
