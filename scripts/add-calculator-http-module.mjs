#!/usr/bin/env node
/**
 * 添加 Calculator HTTP MCP 模块到数据库
 * 
 * 使用方法:
 *   node scripts/add-calculator-http-module.mjs
 *   node scripts/add-calculator-http-module.mjs --port 8080
 */

import { prisma } from "../src/lib/prisma.js";

const args = process.argv.slice(2);
const PORT = args.find((_, i) => args[i - 1] === "--port") || "3001";
const HOST = args.find((_, i) => args[i - 1] === "--host") || "localhost";

const CALCULATOR_HTTP_MODULE = {
  moduleKey: "calculator-http",
  label: "计算器 (HTTP)",
  description: "HTTP 版本的计算器 MCP Server，支持远程调用",
  transport: "STREAMABLE_HTTP",
  endpointUrl: `http://${HOST}:${PORT}`,
  headers: {},
  connectionConfig: {
    timeout: 30000,
    retries: 3
  },
  keywordHints: [
    "计算",
    "加法",
    "减法",
    "乘法",
    "除法",
    "平方根",
    "幂运算",
    "阶乘",
    "calculator",
    "http"
  ],
  toolAllowlist: [], // 允许所有工具
  modeHint: "AUTO",
  isEnabled: true
};

async function main() {
  console.log("🌐 正在添加 Calculator HTTP MCP 模块...\n");
  console.log(`📡 HTTP Endpoint: ${CALCULATOR_HTTP_MODULE.endpointUrl}\n`);

  try {
    // 检查是否已存在
    const existing = await prisma.qaMcpModule.findUnique({
      where: { moduleKey: CALCULATOR_HTTP_MODULE.moduleKey }
    });

    if (existing) {
      console.log(`⚠️  模块 "${CALCULATOR_HTTP_MODULE.moduleKey}" 已存在，正在更新...`);
      
      const updated = await prisma.qaMcpModule.update({
        where: { moduleKey: CALCULATOR_HTTP_MODULE.moduleKey },
        data: {
          label: CALCULATOR_HTTP_MODULE.label,
          description: CALCULATOR_HTTP_MODULE.description,
          transport: CALCULATOR_HTTP_MODULE.transport,
          endpointUrl: CALCULATOR_HTTP_MODULE.endpointUrl,
          headers: CALCULATOR_HTTP_MODULE.headers,
          connectionConfig: CALCULATOR_HTTP_MODULE.connectionConfig,
          keywordHints: CALCULATOR_HTTP_MODULE.keywordHints,
          toolAllowlist: CALCULATOR_HTTP_MODULE.toolAllowlist,
          modeHint: CALCULATOR_HTTP_MODULE.modeHint,
          isEnabled: CALCULATOR_HTTP_MODULE.isEnabled
        }
      });

      console.log(`✅ 模块已更新: ID=${updated.id}, Key="${updated.moduleKey}"`);
    } else {
      console.log(`➕ 正在创建新模块...`);
      
      const created = await prisma.qaMcpModule.create({
        data: CALCULATOR_HTTP_MODULE
      });

      console.log(`✅ 模块已创建: ID=${created.id}, Key="${created.moduleKey}"`);
    }

    console.log("\n📋 模块配置:");
    console.log(`   名称: ${CALCULATOR_HTTP_MODULE.label}`);
    console.log(`   传输方式: ${CALCULATOR_HTTP_MODULE.transport}`);
    console.log(`   端点: ${CALCULATOR_HTTP_MODULE.endpointUrl}`);
    console.log(`   超时: ${CALCULATOR_HTTP_MODULE.connectionConfig.timeout}ms`);
    console.log(`   重试: ${CALCULATOR_HTTP_MODULE.connectionConfig.retries}次`);
    console.log(`\n🔧 可用工具: add, subtract, multiply, divide, power, sqrt, factorial, modulo, absolute, round, get_pi, get_e`);
    console.log("\n💡 使用提示:");
    console.log("   - 确保 HTTP 服务器已启动: npm run mcp:calculator:http");
    console.log("   - 在 QA 助手中使用计算相关关键词触发");
    console.log("   - 也可以直接通过 HTTP API 调用");
    console.log(`   - API 地址: ${CALCULATOR_HTTP_MODULE.endpointUrl}/call`);

  } catch (error) {
    console.error("\n❌ 添加模块失败:", error.message);
    
    if (error.message.includes("QaMcpModule")) {
      console.error("\n⚠️  请确保数据库表 QaMcpModule 已创建。运行:");
      console.error("   npx prisma migrate dev");
    }
    
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
