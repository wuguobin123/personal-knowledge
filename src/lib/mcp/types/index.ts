/**
 * MCP Types - 与数据库模型保持一致
 */

export type McpTransportType = "streamable_http" | "sse" | "stdio";

export interface McpModule {
  id: number;
  moduleKey: string;
  label: string;
  description: string;
  transport: McpTransportType;
  endpointUrl: string;
  headers: Record<string, string>;
  connectionConfig: Record<string, unknown>;
  keywordHints: string[];
  toolAllowlist: string[];
  modeHint: "auto" | "blog" | "web";
  isEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: unknown;
}

export interface McpToolResult {
  content: Array<{
    type: "text" | "image" | "resource";
    text?: string;
    data?: string;
    uri?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
}

export interface McpConnectionState {
  status: "connecting" | "connected" | "disconnected" | "error";
  error?: string;
  lastConnectedAt?: Date;
  retryCount: number;
}

export interface McpClientOptions {
  timeoutMs?: number;
  maxRetries?: number;
  autoConnect?: boolean;
}

// 从原 qa/mcp-core.ts 导入的错误代码
export const MCP_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  REQUEST_FAILED: -32800,
  REQUEST_CANCELLED: -32900,
  INVALID_REQUEST_MCP: -32901,
  METHOD_NOT_IMPLEMENTED: -32902,
  UNAUTHORIZED: -32903,
  INVALID_RESULT: -32904,
  RESOURCE_NOT_FOUND: -32905,
  TIMEOUT: -32906,
  RATE_LIMITED: -32907,
  SERVER_NOT_INITIALIZED: -32908,
  SERVER_ALREADY_INITIALIZED: -32909,
} as const;

export type McpErrorCode = typeof MCP_ERROR_CODES[keyof typeof MCP_ERROR_CODES];
