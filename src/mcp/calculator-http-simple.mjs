#!/usr/bin/env node
/**
 * MCP Calculator Server - Simple HTTP Version
 * 
 * 简化版 HTTP MCP Server，支持基本的 HTTP 请求
 * 
 * 启动:
 *   node src/mcp/calculator-http-simple.mjs          # 默认端口 3001
 *   PORT=8080 node src/mcp/calculator-http-simple.mjs # 指定端口
 */

import express from "express";
import cors from "cors";
import { z } from "zod";

const app = express();
const PORT = process.env.PORT || 3001;

// 中间件
app.use(cors());
app.use(express.json());

// 工具定义
const tools = {
  add: {
    description: "Add two numbers together (a + b)",
    parameters: {
      a: { type: "number", description: "First number" },
      b: { type: "number", description: "Second number" }
    },
    handler: ({ a, b }) => ({ result: a + b })
  },
  subtract: {
    description: "Subtract two numbers (a - b)",
    parameters: {
      a: { type: "number", description: "Minuend" },
      b: { type: "number", description: "Subtrahend" }
    },
    handler: ({ a, b }) => ({ result: a - b })
  },
  multiply: {
    description: "Multiply two numbers (a × b)",
    parameters: {
      a: { type: "number", description: "First factor" },
      b: { type: "number", description: "Second factor" }
    },
    handler: ({ a, b }) => ({ result: a * b })
  },
  divide: {
    description: "Divide two numbers (a ÷ b)",
    parameters: {
      a: { type: "number", description: "Dividend" },
      b: { type: "number", description: "Divisor" }
    },
    handler: ({ a, b }) => {
      if (b === 0) throw new Error("Division by zero");
      return { result: a / b };
    }
  },
  power: {
    description: "Calculate power (base^exponent)",
    parameters: {
      base: { type: "number", description: "Base number" },
      exponent: { type: "number", description: "Exponent" }
    },
    handler: ({ base, exponent }) => ({ result: Math.pow(base, exponent) })
  },
  sqrt: {
    description: "Calculate square root (√x)",
    parameters: {
      number: { type: "number", description: "Non-negative number", min: 0 }
    },
    handler: ({ number }) => ({ result: Math.sqrt(number) })
  },
  factorial: {
    description: "Calculate factorial (n!)",
    parameters: {
      n: { type: "integer", description: "Non-negative integer (0-20)", min: 0, max: 20 }
    },
    handler: ({ n }) => {
      let result = 1;
      for (let i = 2; i <= n; i++) result *= i;
      return { result };
    }
  },
  modulo: {
    description: "Calculate modulo (a % b)",
    parameters: {
      a: { type: "number", description: "Dividend" },
      b: { type: "number", description: "Divisor" }
    },
    handler: ({ a, b }) => {
      if (b === 0) throw new Error("Division by zero");
      return { result: a % b };
    }
  },
  absolute: {
    description: "Calculate absolute value (|x|)",
    parameters: {
      number: { type: "number", description: "Number" }
    },
    handler: ({ number }) => ({ result: Math.abs(number) })
  },
  round: {
    description: "Round to decimal places",
    parameters: {
      number: { type: "number", description: "Number to round" },
      decimals: { type: "integer", description: "Decimal places", default: 0, min: 0, max: 10 }
    },
    handler: ({ number, decimals }) => ({ 
      result: Number(number.toFixed(decimals)) 
    })
  },
  get_pi: {
    description: "Get the value of Pi (π)",
    parameters: {},
    handler: () => ({ result: Math.PI })
  },
  get_e: {
    description: "Get Euler's number (e)",
    parameters: {},
    handler: () => ({ result: Math.E })
  }
};

// 验证参数
function validateParams(toolName, params) {
  const tool = tools[toolName];
  if (!tool) throw new Error(`Unknown tool: ${toolName}`);

  const result = {};
  for (const [key, schema] of Object.entries(tool.parameters)) {
    let value = params[key];
    
    // 检查默认值
    if (value === undefined) {
      if (schema.default !== undefined) {
        value = schema.default;
      } else {
        throw new Error(`Missing required parameter: ${key}`);
      }
    }

    // 类型检查
    if (schema.type === "integer") {
      if (!Number.isInteger(value)) {
        throw new Error(`Parameter ${key} must be an integer`);
      }
    } else if (schema.type === "number") {
      if (typeof value !== "number" || isNaN(value)) {
        throw new Error(`Parameter ${key} must be a number`);
      }
    }

    // 范围检查
    if (schema.min !== undefined && value < schema.min) {
      throw new Error(`Parameter ${key} must be >= ${schema.min}`);
    }
    if (schema.max !== undefined && value > schema.max) {
      throw new Error(`Parameter ${key} must be <= ${schema.max}`);
    }

    result[key] = value;
  }

  return result;
}

// 健康检查
app.get("/", (req, res) => {
  res.json({
    name: "calculator-http-simple",
    version: "1.0.0",
    description: "Simple HTTP MCP Calculator Server",
    endpoints: {
      tools: "/tools",
      call: "/call (POST)",
      health: "/health"
    }
  });
});

// 获取工具列表
app.get("/tools", (req, res) => {
  const toolList = Object.entries(tools).map(([name, tool]) => ({
    name,
    description: tool.description,
    parameters: tool.parameters
  }));
  
  res.json({ tools: toolList });
});

// 调用工具
app.post("/call", async (req, res) => {
  try {
    const { tool, params = {} } = req.body;
    
    if (!tool) {
      return res.status(400).json({
        error: "Missing 'tool' field"
      });
    }

    if (!tools[tool]) {
      return res.status(404).json({
        error: `Unknown tool: ${tool}`
      });
    }

    // 验证参数
    const validatedParams = validateParams(tool, params);
    
    // 执行工具
    const startTime = Date.now();
    const result = await tools[tool].handler(validatedParams);
    const duration = Date.now() - startTime;

    res.json({
      success: true,
      tool,
      params: validatedParams,
      result,
      duration_ms: duration
    });

  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// 批量调用
app.post("/batch", async (req, res) => {
  try {
    const { calls } = req.body;
    
    if (!Array.isArray(calls)) {
      return res.status(400).json({
        error: "Missing or invalid 'calls' field (must be array)"
      });
    }

    const results = [];
    for (const call of calls) {
      try {
        const { tool, params = {} } = call;
        if (!tools[tool]) {
          results.push({
            success: false,
            tool,
            error: `Unknown tool: ${tool}`
          });
          continue;
        }

        const validatedParams = validateParams(tool, params);
        const result = await tools[tool].handler(validatedParams);
        
        results.push({
          success: true,
          tool,
          params: validatedParams,
          result
        });
      } catch (error) {
        results.push({
          success: false,
          tool: call.tool,
          error: error.message
        });
      }
    }

    res.json({ results });

  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

// 健康检查
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    tools_available: Object.keys(tools).length
  });
});

// 错误处理
app.use((err, req, res, next) => {
  console.error("Error:", err);
  res.status(500).json({
    error: "Internal server error"
  });
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`🧮 Calculator HTTP Server running on http://localhost:${PORT}`);
  console.log(`📚 API Endpoints:`);
  console.log(`   GET  /          - Server info`);
  console.log(`   GET  /tools     - List available tools`);
  console.log(`   POST /call      - Call a tool`);
  console.log(`   POST /batch     - Batch call tools`);
  console.log(`   GET  /health    - Health check`);
  console.log(`🔧 Available tools: ${Object.keys(tools).join(", ")}`);
});
