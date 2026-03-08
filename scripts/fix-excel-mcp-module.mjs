#!/usr/bin/env node
/**
 * 修复 Excel MCP 模块配置
 * 修复 connectionConfig 格式问题
 */

import { PrismaClient } from "@prisma/client";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import process from "node:process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient();

// 加载 .env.local
function loadEnvLocal() {
  const envLocalPath = path.join(__dirname, "..", ".env.local");
  if (fs.existsSync(envLocalPath)) {
    const content = fs.readFileSync(envLocalPath, "utf8");
    const lines = content.split("\n");
    for (const line of lines) {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        let value = match[2].trim().replace(/^["']|["']$/g, "");
        process.env[key] = value;
      }
    }
  }
}

loadEnvLocal();

async function fixModules() {
  console.log("=" .repeat(60));
  console.log("修复 Excel MCP 模块配置");
  console.log("=" .repeat(60));

  // 正确的 connectionConfig
  const correctConnectionConfig = JSON.stringify({
    command: "node",
    args: ["scripts/mcp-excel-server.mjs"],
    env: {},
    cwd: "."
  });

  // 正确的 keywordHints
  const correctKeywordHints = JSON.stringify([
    "excel", "xlsx", "xls", "csv", "表格", "电子表格", "spreadsheet",
    "分析", "统计", "汇总", "求和", "平均", "最大值", "最小值", "中位数",
    "数据分布", "列统计", "数值分析",
    "读取", "查看", "预览", "浏览", "打开表格",
    "列名", "表头", "行数", "工作表", "sheet",
  ]);

  console.log("\n1. 查找 Excel 相关模块...");
  
  // 查找 Excel 模块
  const modules = await prisma.$queryRaw`
    SELECT id, moduleKey, label, connectionConfig, keywordHints
    FROM QaMcpModule
    WHERE moduleKey LIKE '%excel%' OR label LIKE '%Excel%'
  `;

  if (modules.length === 0) {
    console.log("   没有找到 Excel 模块，创建新模块...");
    
    // 创建新模块
    await prisma.$executeRaw`
      INSERT INTO QaMcpModule (
        moduleKey, label, description, transport, endpointUrl,
        headers, connectionConfig, keywordHints, toolAllowlist,
        modeHint, isEnabled, createdAt, updatedAt
      ) VALUES (
        'mcp-excel-analysis-v2',
        'Excel 数据分析',
        '分析 Excel/CSV 文件结构，读取数据，执行统计分析（最大值、最小值、平均值、中位数等）',
        'STDIO',
        '',
        NULL,
        ${correctConnectionConfig},
        ${correctKeywordHints},
        NULL,
        'AUTO',
        1,
        NOW(3),
        NOW(3)
      )
    `;
    console.log("   ✓ 新模块已创建: mcp-excel-analysis-v2");
  } else {
    console.log(`   找到 ${modules.length} 个 Excel 模块，开始修复...\n`);
    
    for (const m of modules) {
      console.log(`   修复模块: ${m.moduleKey}`);
      
      // 检查当前配置
      let currentConfig = {};
      try {
        currentConfig = JSON.parse(m.connectionConfig || '{}');
      } catch {
        console.log(`      ⚠️  当前配置格式错误，将重置`);
      }
      
      // 合并配置（保留 cwd 如果存在）
      const newConfig = {
        command: "node",
        args: ["scripts/mcp-excel-server.mjs"],
        env: currentConfig.env || {},
        cwd: currentConfig.cwd || "."
      };
      
      await prisma.$executeRaw`
        UPDATE QaMcpModule
        SET 
          connectionConfig = ${JSON.stringify(newConfig)},
          keywordHints = ${correctKeywordHints},
          isEnabled = 1,
          updatedAt = NOW(3)
        WHERE id = ${m.id}
      `;
      
      console.log(`      ✓ 配置已更新`);
    }
  }

  // 验证修复结果
  console.log("\n2. 验证修复结果...");
  const updated = await prisma.$queryRaw`
    SELECT 
      moduleKey,
      label,
      isEnabled,
      JSON_EXTRACT(connectionConfig, '$.command') as cmd,
      JSON_EXTRACT(connectionConfig, '$.args') as args,
      JSON_LENGTH(keywordHints) as hintCount
    FROM QaMcpModule
    WHERE moduleKey LIKE '%excel%'
  `;

  for (const m of updated) {
    console.log(`\n   ${m.moduleKey}:`);
    console.log(`      启用: ${m.isEnabled ? '✓' : '✗'}`);
    console.log(`      命令: ${m.cmd}`);
    console.log(`      参数: ${m.args}`);
    console.log(`      关键词数: ${m.hintCount}`);
  }

  console.log("\n" + "=" .repeat(60));
  console.log("修复完成!");
  console.log("=" .repeat(60));
  console.log("\n现在 Excel MCP 模块应该可以正常工作了。");
  console.log("请重新测试 QA 助手中的 Excel 分析功能。");

  await prisma.$disconnect();
}

fixModules().catch(err => {
  console.error("修复失败:", err);
  process.exit(1);
});
