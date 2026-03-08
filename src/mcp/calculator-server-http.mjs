#!/usr/bin/env node
/**
 * MCP Calculator Server - HTTP 版本
 * 
 * 支持 Streamable HTTP 和 SSE 传输方式
 * 可以对外暴露，支持多客户端同时连接
 * 
 * 协议版本: Model Context Protocol 2025-03-26
 * 
 * 启动方式:
 *   node src/mcp/calculator-server-http.mjs          # 默认端口 3001
 *   node src/mcp/calculator-server-http.mjs --port 8080  # 指定端口
 *   node src/mcp/calculator-server-http.mjs --sse        # 使用 SSE 传输
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import { z } from "zod";
import cors from "cors";

// ============ 配置解析 ============
const args = process.argv.slice(2);
const PORT = parseInt(args.find((_, i) => args[i - 1] === "--port") || "3001");
const USE_SSE = args.includes("--sse");
const USE_STDIO = args.includes("--stdio");

// ============ 服务器配置 ============
const SERVER_CONFIG = {
  name: "calculator-server-http",
  version: "1.0.0",
  description: "HTTP-enabled MCP calculator server providing basic arithmetic operations"
};

// ============ 创建 MCP 服务器实例 ============
const server = new McpServer(SERVER_CONFIG);

// ============ 注册所有工具 ============

// 基础运算
server.tool("add", "Add two numbers together (a + b)", {
  a: z.number().describe("The first number"),
  b: z.number().describe("The second number")
}, async ({ a, b }) => ({
  content: [{ type: "text", text: String(a + b) }],
  isError: false
}));

server.tool("subtract", "Subtract two numbers (a - b)", {
  a: z.number().describe("The minuend"),
  b: z.number().describe("The subtrahend")
}, async ({ a, b }) => ({
  content: [{ type: "text", text: String(a - b) }],
  isError: false
}));

server.tool("multiply", "Multiply two numbers (a × b)", {
  a: z.number().describe("The first factor"),
  b: z.number().describe("The second factor")
}, async ({ a, b }) => ({
  content: [{ type: "text", text: String(a * b) }],
  isError: false
}));

server.tool("divide", "Divide two numbers (a ÷ b)", {
  a: z.number().describe("The dividend"),
  b: z.number().describe("The divisor")
}, async ({ a, b }) => {
  if (b === 0) {
    return {
      content: [{ type: "text", text: "Error: Division by zero" }],
      isError: true
    };
  }
  return {
    content: [{ type: "text", text: String(a / b) }],
    isError: false
  };
});

// 进阶运算
server.tool("power", "Calculate power (base^exponent)", {
  base: z.number().describe("The base number"),
  exponent: z.number().describe("The exponent")
}, async ({ base, exponent }) => ({
  content: [{ type: "text", text: String(Math.pow(base, exponent)) }],
  isError: false
}));

server.tool("sqrt", "Calculate square root (√x)", {
  number: z.number().min(0).describe("The non-negative number")
}, async ({ number }) => ({
  content: [{ type: "text", text: String(Math.sqrt(number)) }],
  isError: false
}));

server.tool("factorial", "Calculate factorial (n!)", {
  n: z.number().int().min(0).max(20).describe("Non-negative integer (0-20)")
}, async ({ n }) => {
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return {
    content: [{ type: "text", text: String(result) }],
    isError: false
  };
});

server.tool("modulo", "Calculate modulo (a % b)", {
  a: z.number().describe("The dividend"),
  b: z.number().describe("The divisor")
}, async ({ a, b }) => {
  if (b === 0) {
    return {
      content: [{ type: "text", text: "Error: Division by zero" }],
      isError: true
    };
  }
  return {
    content: [{ type: "text", text: String(a % b) }],
    isError: false
  };
});

server.tool("absolute", "Calculate absolute value (|x|)", {
  number: z.number().describe("The number")
}, async ({ number }) => ({
  content: [{ type: "text", text: String(Math.abs(number)) }],
  isError: false
}));

server.tool("round", "Round to decimal places", {
  number: z.number().describe("The number to round"),
  decimals: z.number().int().min(0).max(10).default(0).describe("Decimal places")
}, async ({ number, decimals }) => ({
  content: [{ type: "text", text: String(Number(number.toFixed(decimals))) }],
  isError: false
}));

// 常量
server.tool("get_pi", "Get the value of Pi (π)", {}, async () => ({
  content: [{ type: "text", text: String(Math.PI) }],
  isError: false
}));

server.tool("get_e", "Get Euler's number (e)", {}, async () => ({
  content: [{ type: "text", text: String(Math.E) }],
  isError: false
}));

// ============ HTTP 服务器 ============

async function startHttpServer() {
  const app = express();
  
  // 启用 CORS（允许跨域访问）
  app.use(cors({
    origin: "*",  // 生产环境应限制具体域名
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"]
  }));
  
  // 解析 JSON body
  app.use(express.json());

  // 健康检查端点
  app.get("/health", (req, res) => {
    res.json({
      status: "ok",
      server: SERVER_CONFIG.name,
      version: SERVER_CONFIG.version,
      uptime: process.uptime()
    });
  });

  // MCP 端点信息
  app.get("/", (req, res) => {
    res.json({
      name: SERVER_CONFIG.name,
      version: SERVER_CONFIG.version,
      description: SERVER_CONFIG.description,
      endpoints: {
        mcp: "/mcp",
        health: "/health",
        docs: "/docs"
      }
    });
  });

  // 如果使用 SSE 传输
  if (USE_SSE) {
    console.error(`📡 Starting MCP HTTP Server with SSE transport on port ${PORT}`);
    
    let transport = null;
    
    // SSE 端点
    app.get("/mcp", async (req, res) => {
      console.error("🔗 New SSE connection established");
      transport = new SSEServerTransport("/mcp/message", res);
      await server.connect(transport);
    });
    
    // 消息接收端点
    app.post("/mcp/message", async (req, res) => {
      if (!transport) {
        res.status(400).json({ error: "No active SSE connection" });
        return;
      }
      await transport.handlePostMessage(req, res);
    });
    
  } else {
    // Streamable HTTP 传输（推荐）
    console.error(`📡 Starting MCP HTTP Server with Streamable HTTP on port ${PORT}`);
    
    app.post("/mcp", async (req, res) => {
      try {
        // 这里简化处理，实际应根据 MCP Streamable HTTP 规范实现
        // 需要处理 session 管理、流控等
        const { method, params, id } = req.body;
        
        // 调用工具
        if (method === "tools/call") {
          const result = await server.callTool(params.name, params.arguments);
          res.json({
            jsonrpc: "2.0",
            id,
            result
          });
        } else {
          res.status(400).json({
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: "Method not found" }
          });
        }
      } catch (error) {
        console.error("Error handling request:", error);
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: error.message }
        });
      }
    });
  }

  // 启动服务器
  app.listen(PORT, () => {
    console.error(`✅ ${SERVER_CONFIG.name} v${SERVER_CONFIG.version} is running`);
    console.error(`📡 Transport: ${USE_SSE ? "SSE" : "Streamable HTTP"}`);
    console.error(`🌐 Endpoint: http://localhost:${PORT}/mcp`);
    console.error(`🏥 Health: http://localhost:${PORT}/health`);
    console.error(`🔧 Available tools: add, subtract, multiply, divide, power, sqrt, factorial, modulo, absolute, round, get_pi, get_e`);
  });
}

// ============ 启动服务器 ============

async function main() {
  // HTTP 模式
  if (!USE_STDIO) {
    await startHttpServer();
  } else {
    // STDIO 模式（兼容原有方式）
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`✅ ${SERVER_CONFIG.name} v${SERVER_CONFIG.version} is running (stdio mode)`);
  }
}

main().catch((error) => {
  console.error("❌ Fatal error:", error);
  process.exit(1);
});
