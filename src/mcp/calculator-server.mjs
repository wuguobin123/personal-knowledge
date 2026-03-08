#!/usr/bin/env node
/**
 * MCP Calculator Server
 * 
 * 一个符合 MCP 业界标准的计算器服务器实现
 * 支持客户端: Claude Desktop, Cursor, Cline, Kimi Code, Windsurf, etc.
 * 
 * 协议版本: Model Context Protocol 2025-03-26
 * 传输方式: stdio (默认), SSE (可选)
 * 
 * @see https://modelcontextprotocol.io/specification/2025-03-26
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ============ 服务器配置 ============
const SERVER_CONFIG = {
  name: "calculator-server",
  version: "1.0.0",
  description: "A standard MCP calculator server providing basic arithmetic operations"
};

// ============ 创建 MCP 服务器实例 ============
const server = new McpServer(SERVER_CONFIG);

// ============ 基础运算工具 ============

/**
 * 加法工具
 * 符合 MCP Tool 规范，返回标准格式的 CallToolResult
 */
server.tool(
  "add",
  "Add two numbers together (a + b)",
  {
    a: z.number().describe("The first number (addend)"),
    b: z.number().describe("The second number (addend)")
  },
  async ({ a, b }) => {
    const result = a + b;
    return {
      content: [{
        type: "text",
        text: String(result)
      }],
      isError: false
    };
  }
);

/**
 * 减法工具
 */
server.tool(
  "subtract",
  "Subtract the second number from the first number (a - b)",
  {
    a: z.number().describe("The minuend (number to subtract from)"),
    b: z.number().describe("The subtrahend (number to subtract)")
  },
  async ({ a, b }) => {
    const result = a - b;
    return {
      content: [{
        type: "text",
        text: String(result)
      }],
      isError: false
    };
  }
);

/**
 * 乘法工具
 */
server.tool(
  "multiply",
  "Multiply two numbers (a × b)",
  {
    a: z.number().describe("The first factor"),
    b: z.number().describe("The second factor")
  },
  async ({ a, b }) => {
    const result = a * b;
    return {
      content: [{
        type: "text",
        text: String(result)
      }],
      isError: false
    };
  }
);

/**
 * 除法工具
 * 包含错误处理：除数为零时返回 isError: true
 */
server.tool(
  "divide",
  "Divide the first number by the second number (a ÷ b)",
  {
    a: z.number().describe("The dividend"),
    b: z.number().describe("The divisor (must not be zero)")
  },
  async ({ a, b }) => {
    if (b === 0) {
      return {
        content: [{
          type: "text",
          text: "Error: Division by zero is not allowed"
        }],
        isError: true
      };
    }
    const result = a / b;
    return {
      content: [{
        type: "text",
        text: String(result)
      }],
      isError: false
    };
  }
);

// ============ 进阶运算工具 ============

/**
 * 幂运算
 */
server.tool(
  "power",
  "Calculate the power of a number (base^exponent)",
  {
    base: z.number().describe("The base number"),
    exponent: z.number().describe("The exponent")
  },
  async ({ base, exponent }) => {
    const result = Math.pow(base, exponent);
    return {
      content: [{
        type: "text",
        text: String(result)
      }],
      isError: false
    };
  }
);

/**
 * 平方根
 * 包含错误处理：负数输入时返回 isError: true
 */
server.tool(
  "sqrt",
  "Calculate the square root of a number (√x)",
  {
    number: z.number().min(0).describe("The non-negative number to calculate square root for")
  },
  async ({ number }) => {
    const result = Math.sqrt(number);
    return {
      content: [{
        type: "text",
        text: String(result)
      }],
      isError: false
    };
  }
);

/**
 * 阶乘
 * 限制最大值为 20，防止整数溢出
 */
server.tool(
  "factorial",
  "Calculate the factorial of a non-negative integer (n!)",
  {
    n: z.number().int().min(0).max(20).describe("A non-negative integer (0-20)")
  },
  async ({ n }) => {
    let result = 1;
    for (let i = 2; i <= n; i++) {
      result *= i;
    }
    return {
      content: [{
        type: "text",
        text: String(result)
      }],
      isError: false
    };
  }
);

/**
 * 取模运算
 */
server.tool(
  "modulo",
  "Calculate the remainder of division (a % b)",
  {
    a: z.number().describe("The dividend"),
    b: z.number().describe("The divisor (must not be zero)")
  },
  async ({ a, b }) => {
    if (b === 0) {
      return {
        content: [{
          type: "text",
          text: "Error: Division by zero is not allowed"
        }],
        isError: true
      };
    }
    const result = a % b;
    return {
      content: [{
        type: "text",
        text: String(result)
      }],
      isError: false
    };
  }
);

/**
 * 绝对值
 */
server.tool(
  "absolute",
  "Calculate the absolute value of a number (|x|)",
  {
    number: z.number().describe("The number")
  },
  async ({ number }) => {
    const result = Math.abs(number);
    return {
      content: [{
        type: "text",
        text: String(result)
      }],
      isError: false
    };
  }
);

/**
 * 四舍五入
 */
server.tool(
  "round",
  "Round a number to specified decimal places",
  {
    number: z.number().describe("The number to round"),
    decimals: z.number().int().min(0).max(10).default(0).describe("Number of decimal places (0-10)")
  },
  async ({ number, decimals }) => {
    const multiplier = Math.pow(10, decimals);
    const result = Math.round(number * multiplier) / multiplier;
    return {
      content: [{
        type: "text",
        text: String(result)
      }],
      isError: false
    };
  }
);

// ============ 数学常量 ============

server.tool(
  "get_pi",
  "Get the mathematical constant Pi (π)",
  {},
  async () => {
    return {
      content: [{
        type: "text",
        text: String(Math.PI)
      }],
      isError: false
    };
  }
);

server.tool(
  "get_e",
  "Get Euler's number (e), the base of natural logarithms",
  {},
  async () => {
    return {
      content: [{
        type: "text",
        text: String(Math.E)
      }],
      isError: false
    };
  }
);

// ============ 服务器启动 ============

/**
 * 主函数 - 启动 MCP 服务器
 * 使用 stdio 传输方式，符合 MCP 标准
 */
async function main() {
  // 创建 stdio 传输层
  // 注意：所有日志必须通过 console.error 输出到 stderr
  // 使用 console.log 会干扰 JSON-RPC 通信
  const transport = new StdioServerTransport();
  
  // 连接服务器到传输层
  await server.connect(transport);
  
  // 输出启动信息到 stderr（不是 stdout!）
  console.error(`✅ ${SERVER_CONFIG.name} v${SERVER_CONFIG.version} is running`);
  console.error("📡 Transport: stdio");
  console.error("🔧 Available tools: add, subtract, multiply, divide, power, sqrt, factorial, modulo, absolute, round, get_pi, get_e");
}

// 启动服务器
main().catch((error) => {
  console.error("❌ Fatal error:", error);
  process.exit(1);
});
