#!/usr/bin/env node
/**
 * MCP Tool 注册示例
 * 
 * 展示各种类型工具的注册方式
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const server = new McpServer({
  name: "examples-server",
  version: "1.0.0"
});

// ============ 示例 1: 简单工具 ============

/**
 * 简单的字符串处理工具
 */
server.tool(
  "reverse_string",
  "Reverse a string (e.g., 'hello' -> 'olleh')",
  {
    text: z.string().min(1).describe("The string to reverse")
  },
  async ({ text }) => {
    const reversed = text.split('').reverse().join('');
    return {
      content: [{ type: "text", text: reversed }],
      isError: false
    };
  }
);

// ============ 示例 2: 带错误处理的工具 ============

/**
 * 文件读取工具（带错误处理）
 */
server.tool(
  "safe_divide",
  "Safely divide two numbers with error handling",
  {
    dividend: z.number().describe("The number to divide"),
    divisor: z.number().describe("The number to divide by")
  },
  async ({ dividend, divisor }) => {
    // 参数验证（Zod 会自动验证类型，这里做业务逻辑验证）
    if (divisor === 0) {
      return {
        content: [{ 
          type: "text", 
          text: "Error: Cannot divide by zero" 
        }],
        isError: true  // 标记为错误
      };
    }
    
    const result = dividend / divisor;
    return {
      content: [{ type: "text", text: String(result) }],
      isError: false
    };
  }
);

// ============ 示例 3: 可选参数和默认值 ============

/**
 * 搜索工具（带分页）
 */
server.tool(
  "search_items",
  "Search items with pagination",
  {
    query: z.string().min(1).describe("Search query string"),
    page: z.number().int().min(1).default(1).describe("Page number (default: 1)"),
    pageSize: z.number().int().min(1).max(100).default(20).describe("Items per page (default: 20, max: 100)")
  },
  async ({ query, page, pageSize }) => {
    // 模拟搜索逻辑
    const mockResults = [
      { id: 1, name: `Result for "${query}" #${(page - 1) * pageSize + 1}` },
      { id: 2, name: `Result for "${query}" #${(page - 1) * pageSize + 2}` }
    ];
    
    return {
      content: [{ 
        type: "text", 
        text: JSON.stringify({
          query,
          page,
          pageSize,
          results: mockResults
        }, null, 2)
      }],
      isError: false
    };
  }
);

// ============ 示例 4: 复杂对象参数 ============

/**
 * 创建用户工具
 */
server.tool(
  "create_user",
  "Create a new user with profile information",
  {
    username: z.string().min(3).max(20).describe("Unique username"),
    email: z.string().email().describe("Valid email address"),
    age: z.number().int().min(0).max(150).optional().describe("User age (optional)"),
    roles: z.array(z.enum(["user", "admin", "moderator"])).default(["user"]).describe("User roles"),
    profile: z.object({
      bio: z.string().max(500).optional().describe("User biography"),
      website: z.string().url().optional().describe("Personal website URL"),
      isPublic: z.boolean().default(true).describe("Whether profile is public")
    }).optional().describe("User profile information")
  },
  async (params) => {
    // 模拟创建用户
    const user = {
      id: Math.random().toString(36).substr(2, 9),
      username: params.username,
      email: params.email,
      age: params.age,
      roles: params.roles,
      profile: params.profile,
      createdAt: new Date().toISOString()
    };
    
    return {
      content: [{ 
        type: "text", 
        text: `User created successfully:\n${JSON.stringify(user, null, 2)}`
      }],
      isError: false
    };
  }
);

// ============ 示例 5: 批量处理工具 ============

/**
 * 批量计算工具
 */
server.tool(
  "batch_calculate",
  "Perform calculations on a list of numbers",
  {
    operation: z.enum(["sum", "average", "max", "min", "count"]).describe("Operation to perform"),
    numbers: z.array(z.number()).min(1).max(1000).describe("List of numbers to process")
  },
  async ({ operation, numbers }) => {
    let result;
    
    switch (operation) {
      case "sum":
        result = numbers.reduce((a, b) => a + b, 0);
        break;
      case "average":
        result = numbers.reduce((a, b) => a + b, 0) / numbers.length;
        break;
      case "max":
        result = Math.max(...numbers);
        break;
      case "min":
        result = Math.min(...numbers);
        break;
      case "count":
        result = numbers.length;
        break;
    }
    
    return {
      content: [{ 
        type: "text", 
        text: `${operation} of ${numbers.length} numbers: ${result}`
      }],
      isError: false
    };
  }
);

// ============ 示例 6: 无参数工具 ============

/**
 * 获取服务器时间
 */
server.tool(
  "get_current_time",
  "Get the current server time",
  {},  // 空对象表示不需要参数
  async () => {
    return {
      content: [{ 
        type: "text", 
        text: new Date().toISOString()
      }],
      isError: false
    };
  }
);

// ============ 示例 7: 条件返回类型 ============

/**
 * 格式化数字
 */
server.tool(
  "format_number",
  "Format a number in various styles",
  {
    number: z.number().describe("The number to format"),
    style: z.enum(["decimal", "percent", "currency", "scientific"]).default("decimal").describe("Formatting style"),
    locale: z.string().default("en-US").describe("Locale string (e.g., 'en-US', 'zh-CN')"),
    currency: z.string().optional().describe("Currency code for currency style (e.g., 'USD', 'CNY')")
  },
  async ({ number, style, locale, currency }) => {
    let formatted;
    
    try {
      switch (style) {
        case "percent":
          formatted = new Intl.NumberFormat(locale, { style: "percent" }).format(number);
          break;
        case "currency":
          if (!currency) {
            return {
              content: [{ type: "text", text: "Error: currency code is required for currency style" }],
              isError: true
            };
          }
          formatted = new Intl.NumberFormat(locale, { 
            style: "currency", 
            currency 
          }).format(number);
          break;
        case "scientific":
          formatted = number.toExponential();
          break;
        default:
          formatted = new Intl.NumberFormat(locale).format(number);
      }
      
      return {
        content: [{ type: "text", text: formatted }],
        isError: false
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error.message}` }],
        isError: true
      };
    }
  }
);

console.log("✅ 工具注册示例已加载");
console.log("📋 已注册的工具:");
console.log("   - reverse_string: 字符串反转");
console.log("   - safe_divide: 安全除法");
console.log("   - search_items: 分页搜索");
console.log("   - create_user: 创建用户（复杂对象）");
console.log("   - batch_calculate: 批量计算");
console.log("   - get_current_time: 获取当前时间（无参数）");
console.log("   - format_number: 数字格式化");
