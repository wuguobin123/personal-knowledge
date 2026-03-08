#!/usr/bin/env node
/**
 * 添加计算器 MCP 模块到数据库
 * 
 * 使用方法:
 *   node scripts/add-calculator-mcp-module.mjs
 */

import { prisma } from "../src/lib/prisma.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CALCULATOR_MODULE = {
  moduleKey: "calculator",
  label: "计算器",
  description: "提供基础数学运算功能的计算器 MCP Server，支持加减乘除、幂运算、平方根、阶乘等操作",
  transport: "STDIO",
  endpointUrl: "",
  headers: {},
  connectionConfig: {
    command: "node",
    args: [path.join(__dirname, "..", "src", "mcp", "calculator-server.mjs")],
    env: {},
    cwd: path.join(__dirname, "..")
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
    "取模",
    "绝对值",
    "四舍五入",
    "数学",
    "calculator",
    "add",
    "subtract",
    "multiply",
    "divide",
    "sqrt",
    "power",
    "factorial"
  ],
  toolAllowlist: [], // 空数组表示允许所有工具
  modeHint: "AUTO",
  isEnabled: true
};

async function main() {
  console.log("🧮 正在添加计算器 MCP 模块...\n");

  try {
    // 检查是否已存在
    const existing = await prisma.qaMcpModule.findUnique({
      where: { moduleKey: CALCULATOR_MODULE.moduleKey }
    });

    if (existing) {
      console.log(`⚠️  模块 "${CALCULATOR_MODULE.moduleKey}" 已存在，正在更新...`);
      
      const updated = await prisma.qaMcpModule.update({
        where: { moduleKey: CALCULATOR_MODULE.moduleKey },
        data: {
          label: CALCULATOR_MODULE.label,
          description: CALCULATOR_MODULE.description,
          transport: CALCULATOR_MODULE.transport,
          endpointUrl: CALCULATOR_MODULE.endpointUrl,
          headers: CALCULATOR_MODULE.headers,
          connectionConfig: CALCULATOR_MODULE.connectionConfig,
          keywordHints: CALCULATOR_MODULE.keywordHints,
          toolAllowlist: CALCULATOR_MODULE.toolAllowlist,
          modeHint: CALCULATOR_MODULE.modeHint,
          isEnabled: CALCULATOR_MODULE.isEnabled
        }
      });

      console.log(`✅ 模块已更新: ID=${updated.id}, Key="${updated.moduleKey}"`);
    } else {
      console.log(`➕ 正在创建新模块...`);
      
      const created = await prisma.qaMcpModule.create({
        data: CALCULATOR_MODULE
      });

      console.log(`✅ 模块已创建: ID=${created.id}, Key="${created.moduleKey}"`);
    }

    console.log("\n📋 模块配置:");
    console.log(`   名称: ${CALCULATOR_MODULE.label}`);
    console.log(`   传输方式: ${CALCULATOR_MODULE.transport}`);
    console.log(`   命令: ${CALCULATOR_MODULE.connectionConfig.command}`);
    console.log(`   参数: ${CALCULATOR_MODULE.connectionConfig.args.join(" ")}`);
    console.log(`   工作目录: ${CALCULATOR_MODULE.connectionConfig.cwd}`);
    console.log(`\n🔧 可用工具: add, subtract, multiply, divide, power, sqrt, factorial, modulo, absolute, round, get_pi, get_e`);
    console.log("\n💡 使用提示:");
    console.log("   - 在 QA 助手中，可以使用与数学计算相关的关键词来触发此模块");
    console.log("   - 例如: \"计算 123 + 456\", \"5的阶乘是多少\", \"求9的平方根\"");

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
