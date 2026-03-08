#!/usr/bin/env node
/**
 * Excel MCP 模块配置脚本
 * 将 Excel 分析 MCP Server 配置到远程数据库中
 * 
 * 使用方法:
 *   node scripts/setup-excel-mcp-module.mjs
 * 
 * 环境变量:
 *   DATABASE_URL - 数据库连接字符串（优先从 .env.local 读取）
 * 
 * 注意: 此脚本会连接远程数据库，请确保网络可达
 */

import { PrismaClient } from "@prisma/client";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 加载 .env.local 文件（如果存在），并覆盖已有环境变量
function loadEnvLocal() {
  const envLocalPath = path.join(__dirname, "..", ".env.local");
  if (fs.existsSync(envLocalPath)) {
    console.log(`   加载: ${path.relative(process.cwd(), envLocalPath)}`);
    const content = fs.readFileSync(envLocalPath, "utf8");
    const lines = content.split("\n");
    let loadedCount = 0;
    for (const line of lines) {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        let value = match[2].trim();
        // 移除引号
        value = value.replace(/^["'](.*)["']$/, "$1");
        // 始终覆盖（.env.local 优先级最高）
        process.env[key] = value;
        loadedCount++;
      }
    }
    return loadedCount;
  }
  return 0;
}

// 优先加载 .env.local（覆盖 .env 的设置）
const envCount = loadEnvLocal();

// 解析数据库连接信息（用于显示，隐藏密码）
function parseDatabaseUrl(url) {
  if (!url) return null;
  try {
    // mysql://user:pass@host:port/db
    const match = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
    if (match) {
      return {
        user: match[1],
        password: "***", // 隐藏密码
        host: match[3],
        port: match[4],
        database: match[5].split("?")[0],
      };
    }
  } catch {
    // ignore
  }
  return null;
}

// 创建 Prisma 客户端（使用环境变量中的 DATABASE_URL）
const prisma = new PrismaClient({
  log: process.env.DEBUG ? ["query", "info", "warn", "error"] : [],
});

// Excel MCP 模块配置
const EXCEL_MCP_CONFIG = {
  label: "Excel 数据分析",
  description: "分析 Excel/CSV 文件结构，读取数据，执行统计分析（最大值、最小值、平均值、中位数等）",
  transport: "stdio",
  endpointUrl: "",
  connectionConfig: {
    command: "node",
    args: [path.join(__dirname, "mcp-excel-server.mjs")],
    env: {},
    cwd: path.join(__dirname, ".."),
  },
  keywordHints: [
    "excel", "xlsx", "xls", "csv", "表格", "电子表格", "spreadsheet",
    "分析", "统计", "汇总", "求和", "平均", "最大值", "最小值", "中位数",
    "数据分布", "列统计", "数值分析",
    "读取", "查看", "预览", "浏览", "打开表格",
    "列名", "表头", "行数", "工作表", "sheet",
  ],
  toolAllowlist: [],
  modeHint: "auto",
  isEnabled: true,
};

async function setupExcelMcpModule() {
  console.log("=" .repeat(60));
  console.log("Excel MCP 模块配置工具");
  console.log("=" .repeat(60));
  
  // 显示环境变量加载信息
  console.log(`\n📁 环境变量: 从 .env.local 加载了 ${envCount} 个变量`);
  
  // 显示数据库连接信息
  const dbUrl = process.env.DATABASE_URL;
  const dbInfo = parseDatabaseUrl(dbUrl);
  
  console.log("\n📡 数据库连接信息:");
  if (dbInfo) {
    console.log(`   URL: ${dbUrl.replace(/:([^:@]+)@/, ":***@")}`);
    console.log(`   主机: ${dbInfo.host}`);
    console.log(`   端口: ${dbInfo.port}`);
    console.log(`   数据库: ${dbInfo.database}`);
    console.log(`   用户: ${dbInfo.user}`);
    
    const isRemote = dbInfo.host !== "127.0.0.1" && dbInfo.host !== "localhost" && dbInfo.host !== "mysql";
    if (isRemote) {
      console.log(`   ⚠️  注意: 将连接到远程数据库!`);
    }
  } else {
    console.log(`   URL: ${dbUrl || "未设置"}`);
    console.error("\n✗ 无法解析 DATABASE_URL，请检查 .env.local 文件");
    process.exit(1);
  }
  
  // 测试数据库连接
  console.log("\n🔌 测试数据库连接...");
  try {
    await prisma.$connect();
    const result = await prisma.$queryRaw`SELECT 1 as test, DATABASE() as db, @@hostname as host`;
    console.log("   ✓ 数据库连接成功");
    console.log(`   当前数据库: ${result[0]?.db}`);
    console.log(`   服务器: ${result[0]?.host}`);
  } catch (error) {
    console.error("   ✗ 数据库连接失败:", error.message);
    console.error("\n请检查:");
    console.error("1. .env.local 文件中的 DATABASE_URL 是否正确");
    console.error("2. 网络是否可以访问远程数据库");
    console.error("3. 数据库用户是否有权限访问");
    console.error("\n诊断命令:");
    console.error(`   ping ${dbInfo?.host}`);
    console.error(`   telnet ${dbInfo?.host} ${dbInfo?.port}`);
    process.exit(1);
  }
  
  try {
    // 检查是否已存在
    console.log("\n1. 检查现有模块...");
    const existing = await prisma.$queryRaw`
      SELECT id, moduleKey, label, isEnabled 
      FROM QaMcpModule 
      WHERE moduleKey LIKE 'mcp-excel%' OR label LIKE '%Excel%'
      ORDER BY createdAt DESC
    `;
    
    if (existing && existing.length > 0) {
      console.log(`   发现 ${existing.length} 个现有 Excel 模块:`);
      existing.forEach(m => {
        console.log(`   - ${m.moduleKey}: ${m.label} (${m.isEnabled ? "✓ 启用" : "✗ 禁用"})`);
      });
      
      console.log(`\n   将更新模块: ${existing[0].moduleKey}`);
      await updateExistingModule(existing[0].id, EXCEL_MCP_CONFIG);
      console.log("   ✓ 模块已更新");
    } else {
      console.log("   未找到现有 Excel 模块，创建新模块...");
      const newKey = await createNewModule(EXCEL_MCP_CONFIG);
      console.log(`   ✓ 新模块已创建: ${newKey}`);
    }
    
    // 显示配置摘要
    console.log("\n2. 配置摘要");
    console.log("   模块名称:", EXCEL_MCP_CONFIG.label);
    console.log("   传输方式:", EXCEL_MCP_CONFIG.transport);
    console.log("   命令:", EXCEL_MCP_CONFIG.connectionConfig.command);
    console.log("   参数:", EXCEL_MCP_CONFIG.connectionConfig.args.join(" "));
    console.log("   工作目录:", EXCEL_MCP_CONFIG.connectionConfig.cwd);
    console.log("   关键词提示:", EXCEL_MCP_CONFIG.keywordHints.slice(0, 5).join(", ") + "...");
    
    // 列出所有模块
    console.log("\n3. 所有 MCP 模块列表");
    const allModules = await prisma.$queryRaw`
      SELECT 
        moduleKey,
        label,
        transport,
        CASE WHEN isEnabled = 1 THEN '✓' ELSE '✗' END as status
      FROM QaMcpModule
      ORDER BY createdAt DESC
    `;
    
    if (allModules && allModules.length > 0) {
      console.table(allModules);
    } else {
      console.log("   (无模块)");
    }
    
    console.log("\n" + "=" .repeat(60));
    console.log("配置完成!");
    console.log("=" .repeat(60));
    console.log("\n使用说明:");
    console.log("1. 在 QA 助手中上传 Excel/CSV 文件");
    console.log("2. 询问 '分析这个表格' 或 '统计各列数据'");
    console.log("3. 系统会自动调用 Excel MCP 工具进行分析");
    
  } catch (error) {
    console.error("\n✗ 配置失败:", error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

async function createNewModule(config) {
  const baseKey = `mcp-excel-${Date.now().toString(36)}`;
  
  const headersJson = config.headers ? JSON.stringify(config.headers) : null;
  const connectionConfigJson = config.connectionConfig ? JSON.stringify(config.connectionConfig) : null;
  const keywordHintsJson = config.keywordHints?.length > 0 ? JSON.stringify(config.keywordHints) : null;
  const toolAllowlistJson = config.toolAllowlist?.length > 0 ? JSON.stringify(config.toolAllowlist) : null;
  
  await prisma.$executeRaw`
    INSERT INTO QaMcpModule (
      moduleKey, label, description, transport, endpointUrl, 
      headers, connectionConfig, keywordHints, toolAllowlist,
      modeHint, isEnabled, createdAt, updatedAt
    ) VALUES (
      ${baseKey},
      ${config.label},
      ${config.description},
      ${config.transport.toUpperCase()},
      ${config.endpointUrl || ""},
      ${headersJson},
      ${connectionConfigJson},
      ${keywordHintsJson},
      ${toolAllowlistJson},
      ${config.modeHint.toUpperCase()},
      ${config.isEnabled ? 1 : 0},
      NOW(3),
      NOW(3)
    )
  `;
  
  console.log(`   创建模块: ${baseKey}`);
  return baseKey;
}

async function updateExistingModule(moduleId, config) {
  const headersJson = config.headers ? JSON.stringify(config.headers) : null;
  const connectionConfigJson = config.connectionConfig ? JSON.stringify(config.connectionConfig) : null;
  const keywordHintsJson = config.keywordHints?.length > 0 ? JSON.stringify(config.keywordHints) : null;
  const toolAllowlistJson = config.toolAllowlist?.length > 0 ? JSON.stringify(config.toolAllowlist) : null;
  
  await prisma.$executeRaw`
    UPDATE QaMcpModule
    SET 
      label = ${config.label},
      description = ${config.description},
      transport = ${config.transport.toUpperCase()},
      endpointUrl = ${config.endpointUrl || ""},
      headers = ${headersJson},
      connectionConfig = ${connectionConfigJson},
      keywordHints = ${keywordHintsJson},
      toolAllowlist = ${toolAllowlistJson},
      modeHint = ${config.modeHint.toUpperCase()},
      isEnabled = ${config.isEnabled ? 1 : 0},
      updatedAt = NOW(3)
    WHERE id = ${moduleId}
  `;
}

// 运行配置
setupExcelMcpModule();
