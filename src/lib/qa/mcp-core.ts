/**
 * MCP Core Types and Error Handling
 * 符合MCP官方规范和JSON-RPC 2.0标准
 */

/**
 * MCP标准错误代码
 * 基于JSON-RPC 2.0标准和MCP规范
 */
export const MCP_ERROR_CODES = {
  // JSON-RPC 2.0 标准错误代码
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,

  // MCP特定错误代码
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

/**
 * MCP标准错误类
 */
export class McpError extends Error {
  constructor(
    public code: McpErrorCode,
    message: string,
    public data?: unknown
  ) {
    super(message);
    this.name = 'McpError';
    Object.setPrototypeOf(this, McpError.prototype);
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      data: this.data,
    };
  }

  toRpcError() {
    return {
      code: this.code,
      message: this.message,
      data: this.data,
    };
  }
}

/**
 * JSON-RPC 2.0 请求类型
 */
export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: string;
  method: string;
  params?: unknown;
};

/**
 * JSON-RPC 2.0 响应类型
 */
export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};

/**
 * JSON-RPC 2.0 通知类型（无响应）
 */
export type JsonRpcNotification = {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
};

/**
 * MCP协议版本
 */
export const MCP_PROTOCOL_VERSIONS = ["2025-03-26", "2024-11-05"] as const;
export type McpProtocolVersion = typeof MCP_PROTOCOL_VERSIONS[number];

/**
 * MCP客户端能力
 */
export const CLIENT_CAPABILITIES = {
  roots: {
    listChanged: true,
  },
  sampling: {},
  tools: {
    listChanged: true,
  },
  prompts: {
    listChanged: true,
  },
  resources: {
    subscribe: true,
    listChanged: true,
  },
} as const;

/**
 * MCP客户端信息
 */
export interface ClientInfo {
  name: string;
  version: string;
}

/**
 * MCP初始化请求参数
 */
export interface InitializeParams {
  protocolVersion: McpProtocolVersion;
  capabilities: Record<string, unknown>;
  clientInfo: ClientInfo;
  implementation?: {
    name: string;
    version: string;
  };
}

/**
 * MCP服务器信息
 */
export interface ServerInfo {
  name: string;
  version: string;
  protocolVersion: string;
  capabilities: Record<string, unknown>;
}

/**
 * MCP工具定义
 */
export interface McpTool {
  name: string;
  description?: string;
  inputSchema: unknown;
}

/**
 * MCP工具列表响应
 */
export interface McpToolListResponse {
  tools: McpTool[];
  nextCursor?: string;
}

/**
 * MCP工具调用参数
 */
export interface McpToolCallParams {
  name: string;
  arguments?: Record<string, unknown>;
  _meta?: {
    progressToken?: string;
  };
}

/**
 * MCP工具调用结果
 */
export interface McpToolResult {
  content: Array<{
    type: "text" | "image" | "resource";
    text?: string;
    data?: string;
    uri?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
}

/**
 * MCP请求ID生成器
 * 遵循JSON-RPC 2.0规范，ID应该是字符串、数字或null
 */
export class McpRequestIdGenerator {
  private static currentId = 1;
  private static readonly prefix = "req_";

  static generate(): string {
    const id = `${this.prefix}${this.currentId++}`;
    // 防止溢出，虽然在实际使用中不太可能
    if (this.currentId > Number.MAX_SAFE_INTEGER) {
      this.currentId = 1;
    }
    return id;
  }

  static generateMultiple(count: number): string[] {
    return Array.from({ length: count }, () => this.generate());
  }

  static reset(): void {
    this.currentId = 1;
  }

  /**
   * 验证ID是否符合JSON-RPC 2.0规范
   */
  static isValid(id: unknown): boolean {
    return typeof id === 'string' || typeof id === 'number' || id === null;
  }
}

/**
 * 错误处理工具函数
 */
export class McpErrorHandler {
  /**
   * 处理MCP错误并转换为标准格式
   */
  static handle(error: unknown): McpError {
    if (error instanceof McpError) {
      return error;
    }

    if (error instanceof Error) {
      // 根据错误消息和类型映射到MCP错误代码
      if (error.name === 'AbortError' || error.message.includes('aborted')) {
        return new McpError(MCP_ERROR_CODES.REQUEST_CANCELLED, error.message);
      }
      if (error.message.includes('timeout') || error.message.includes('Timeout')) {
        return new McpError(MCP_ERROR_CODES.TIMEOUT, error.message);
      }
      if (error.message.includes('not found') || error.message.includes('NotFound')) {
        return new McpError(MCP_ERROR_CODES.RESOURCE_NOT_FOUND, error.message);
      }
      if (error.message.includes('unauthorized') || error.message.includes('Unauthorized')) {
        return new McpError(MCP_ERROR_CODES.UNAUTHORIZED, error.message);
      }
      if (error.message.includes('rate limit') || error.message.includes('RateLimit')) {
        return new McpError(MCP_ERROR_CODES.RATE_LIMITED, error.message);
      }
      if (error.message.includes('parse') || error.message.includes('JSON')) {
        return new McpError(MCP_ERROR_CODES.PARSE_ERROR, error.message);
      }

      // 默认返回内部错误
      return new McpError(MCP_ERROR_CODES.INTERNAL_ERROR, error.message, {
        originalError: error.name,
        stack: error.stack,
      });
    }

    return new McpError(MCP_ERROR_CODES.INTERNAL_ERROR, 'Unknown error occurred');
  }

  /**
   * 判断错误是否可重试
   */
  static isRetryable(error: McpError): boolean {
    const retryableCodes: McpErrorCode[] = [
      MCP_ERROR_CODES.REQUEST_FAILED,
      MCP_ERROR_CODES.INTERNAL_ERROR,
      MCP_ERROR_CODES.TIMEOUT,
      MCP_ERROR_CODES.RATE_LIMITED,
      MCP_ERROR_CODES.PARSE_ERROR,
    ];
    return retryableCodes.includes(error.code);
  }

  /**
   * 格式化错误消息
   */
  static formatError(error: unknown): string {
    const mcpError = this.handle(error);
    return `[MCP-${mcpError.code}] ${mcpError.message}${
      mcpError.data ? ` | ${JSON.stringify(mcpError.data)}` : ''
    }`;
  }
}

/**
 * MCP日志级别
 */
export enum McpLogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
}

/**
 * MCP日志条目
 */
export interface McpLogEntry {
  timestamp: string;
  level: McpLogLevel;
  moduleKey: string;
  message: string;
  data?: unknown;
  error?: unknown;
  duration?: number; // 执行时间（毫秒）
}

/**
 * MCP日志管理器
 */
export class McpLogger {
  private static isEnabled = process.env.NODE_ENV !== 'production';
  private static logBuffer: McpLogEntry[] = [];
  private static readonly MAX_BUFFER_SIZE = 1000;

  /**
   * 启用/禁用日志
   */
  static setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
  }

  /**
   * 记录日志
   */
  private static log(
    level: McpLogLevel,
    moduleKey: string,
    message: string,
    data?: unknown,
    error?: unknown,
    duration?: number
  ): void {
    if (!this.isEnabled) return;

    const entry: McpLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      moduleKey,
      message,
      data,
      error,
      duration,
    };

    // 添加到缓冲区
    this.logBuffer.push(entry);
    if (this.logBuffer.length > this.MAX_BUFFER_SIZE) {
      this.logBuffer.shift();
    }

    // 输出到控制台
    const logMessage = `[MCP ${level.toUpperCase()}] ${moduleKey}: ${message}${
      duration ? ` (${duration}ms)` : ''
    }`;
    const consoleMethod = console[level] as (message: string, ...args: unknown[]) => void;
    consoleMethod(logMessage, data || error || '');
  }

  static debug(moduleKey: string, message: string, data?: unknown): void {
    this.log(McpLogLevel.DEBUG, moduleKey, message, data);
  }

  static info(moduleKey: string, message: string, data?: unknown): void {
    this.log(McpLogLevel.INFO, moduleKey, message, data);
  }

  static warn(moduleKey: string, message: string, data?: unknown): void {
    this.log(McpLogLevel.WARN, moduleKey, message, data);
  }

  static error(moduleKey: string, message: string, error?: unknown, data?: unknown): void {
    this.log(McpLogLevel.ERROR, moduleKey, message, data, error);
  }

  static logDuration(
    moduleKey: string,
    message: string,
    duration: number,
    data?: unknown
  ): void {
    this.log(McpLogLevel.INFO, moduleKey, message, data, undefined, duration);
  }

  /**
   * 获取日志缓冲区
   */
  static getLogs(): McpLogEntry[] {
    return [...this.logBuffer];
  }

  /**
   * 清空日志缓冲区
   */
  static clearLogs(): void {
    this.logBuffer = [];
  }

  /**
   * 按条件过滤日志
   */
  static filterLogs(filter: {
    level?: McpLogLevel;
    moduleKey?: string;
    since?: Date;
  }): McpLogEntry[] {
    return this.logBuffer.filter(entry => {
      if (filter.level && entry.level !== filter.level) return false;
      if (filter.moduleKey && entry.moduleKey !== filter.moduleKey) return false;
      if (filter.since && new Date(entry.timestamp) < filter.since) return false;
      return true;
    });
  }
}

/**
 * MCP性能监控
 */
export class McpPerformanceMonitor {
  private static metrics = new Map<string, {
    count: number;
    totalTime: number;
    minTime: number;
    maxTime: number;
    errors: number;
  }>();

  static startTimer(operation: string): () => void {
    const startTime = Date.now();
    return () => {
      const duration = Date.now() - startTime;
      this.recordMetric(operation, duration);
    };
  }

  private static recordMetric(operation: string, duration: number, isError = false): void {
    const existing = this.metrics.get(operation) || {
      count: 0,
      totalTime: 0,
      minTime: Infinity,
      maxTime: 0,
      errors: 0,
    };

    existing.count++;
    existing.totalTime += duration;
    existing.minTime = Math.min(existing.minTime, duration);
    existing.maxTime = Math.max(existing.maxTime, duration);
    if (isError) existing.errors++;

    this.metrics.set(operation, existing);
  }

  static recordError(operation: string): void {
    this.recordMetric(operation, 0, true);
  }

  static getMetrics(): Record<string, {
    count: number;
    avgTime: number;
    minTime: number;
    maxTime: number;
    errors: number;
    errorRate: number;
  }> {
    const result: Record<string, {
      count: number;
      avgTime: number;
      minTime: number;
      maxTime: number;
      errors: number;
      errorRate: number;
    }> = {};

    for (const [operation, metrics] of this.metrics.entries()) {
      result[operation] = {
        count: metrics.count,
        avgTime: metrics.totalTime / metrics.count,
        minTime: metrics.minTime === Infinity ? 0 : metrics.minTime,
        maxTime: metrics.maxTime,
        errors: metrics.errors,
        errorRate: metrics.errors / metrics.count,
      };
    }

    return result;
  }

  static clearMetrics(): void {
    this.metrics.clear();
  }
}

/**
 * MCP重试配置
 */
export interface RetryConfig {
  maxRetries?: number;
  retryDelay?: number;
  backoffMultiplier?: number;
  maxDelay?: number;
  retryableErrors?: McpErrorCode[];
  signal?: AbortSignal;
}

/**
 * MCP重试管理器
 */
export class McpRetryManager {
  private static DEFAULT_CONFIG: Required<Omit<RetryConfig, 'signal'>> & { signal?: AbortSignal } = {
    maxRetries: 3,
    retryDelay: 1000,
    backoffMultiplier: 2,
    maxDelay: 10000,
    retryableErrors: [],
    signal: undefined,
  };

  static async executeWithRetry<T>(
    operation: () => Promise<T>,
    moduleKey: string,
    config: RetryConfig = {}
  ): Promise<T> {
    const finalConfig = { ...this.DEFAULT_CONFIG, ...config };
    let lastError: unknown;
    let attempt = 0;

    while (attempt <= finalConfig.maxRetries) {
      try {
        if (finalConfig.signal?.aborted) {
          throw new McpError(MCP_ERROR_CODES.REQUEST_CANCELLED, 'Request cancelled');
        }

        McpLogger.debug(moduleKey, `Attempt ${attempt + 1}/${finalConfig.maxRetries + 1}`);
        const endTimer = McpPerformanceMonitor.startTimer(moduleKey);

        try {
          const result = await operation();
          endTimer();
          return result;
        } catch (error) {
          endTimer();
          throw error;
        }
      } catch (error) {
        lastError = error;
        const mcpError = McpErrorHandler.handle(error);

        if (attempt === finalConfig.maxRetries) {
          McpLogger.error(moduleKey, `All ${finalConfig.maxRetries + 1} attempts failed`, mcpError);
          McpPerformanceMonitor.recordError(moduleKey);
          throw mcpError;
        }

        if (!this.shouldRetry(mcpError, finalConfig)) {
          McpLogger.error(moduleKey, `Error is not retryable`, mcpError);
          McpPerformanceMonitor.recordError(moduleKey);
          throw mcpError;
        }

        const delay = this.calculateDelay(attempt, finalConfig);
        McpLogger.warn(moduleKey, `Attempt ${attempt + 1} failed, retrying in ${delay}ms`, {
          error: mcpError.message,
          attempt: attempt + 1,
        });

        await this.sleep(delay);
        attempt++;
      }
    }

    throw lastError;
  }

  private static shouldRetry(
    error: McpError,
    config: RetryConfig
  ): boolean {
    const retryableErrors = config.retryableErrors ?? [];
    if (retryableErrors.length > 0) {
      return retryableErrors.includes(error.code);
    }
    return McpErrorHandler.isRetryable(error);
  }

  private static calculateDelay(
    attempt: number,
    config: RetryConfig
  ): number {
    const retryDelay = config.retryDelay ?? 1000;
    const backoffMultiplier = config.backoffMultiplier ?? 2;
    const maxDelay = config.maxDelay ?? 10000;
    const delay = retryDelay * Math.pow(backoffMultiplier, attempt);
    return Math.min(delay, maxDelay);
  }

  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
