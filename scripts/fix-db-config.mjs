#!/usr/bin/env node
/**
 * 修复数据库中的 connectionConfig 格式
 */

import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient();

// 加载 .env.local
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

console.log("=" .repeat(60));
console.log("修复数据库 connectionConfig 格式");
console.log("=" .repeat(60));

// 获取所有 Excel 模块
const modules = await prisma.$queryRaw`
  SELECT id, moduleKey, connectionConfig
  FROM QaMcpModule
  WHERE moduleKey LIKE '%excel%'
`;

console.log(`\n找到 ${modules.length} 个 Excel 模块\n`);

for (const m of modules) {
  console.log(`模块: ${m.moduleKey}`);
  
  // 将值转换为字符串
  let configStr = m.connectionConfig;
  if (typeof configStr !== 'string') {
    configStr = String(configStr);
  }
  
  console.log(`当前值: ${configStr.slice(0, 100)}...`);
  
  // 检查是否为有效的 JSON
  let isValid = false;
  let currentObj = null;
  
  try {
    currentObj = JSON.parse(configStr);
    if (typeof currentObj === 'object' && currentObj !== null && !Array.isArray(currentObj)) {
      // 检查 args 是否为数组
      if (Array.isArray(currentObj.args)) {
        isValid = true;
      }
    }
  } catch {
    // 不是有效的 JSON
  }
  
  if (isValid) {
    console.log("   ✓ 配置已是有效的 JSON 格式");
    continue;
  }
  
  // 需要修复 - 创建正确的配置
  const correctConfig = {
    command: "node",
    args: ["scripts/mcp-excel-server.mjs"],
    env: {},
    cwd: "."
  };
  
  // 尝试从当前值提取信息
  const configStr2 = String(m.connectionConfig || '');
  if (configStr2.includes("scripts/mcp-excel")) {
    // 已经包含正确路径，只是格式不对
  }
  
  const configJson = JSON.stringify(correctConfig);
  
  console.log(`   修复为: ${configJson}`);
  
  await prisma.$executeRaw`
    UPDATE QaMcpModule
    SET connectionConfig = ${configJson}
    WHERE id = ${m.id}
  `;
  
  console.log("   ✓ 已修复\n");
}

// 验证
console.log("\n验证修复结果:");
const updated = await prisma.$queryRaw`
  SELECT moduleKey, connectionConfig
  FROM QaMcpModule
  WHERE moduleKey LIKE '%excel%'
`;

for (const m of updated) {
  try {
    const parsed = JSON.parse(m.connectionConfig);
    console.log(`${m.moduleKey}: ${Array.isArray(parsed.args) ? '✓' : '✗'} args 是数组`);
  } catch {
    console.log(`${m.moduleKey}: ✗ 仍不是有效 JSON`);
  }
}

await prisma.$disconnect();

console.log("\n" + "=" .repeat(60));
console.log("修复完成");
console.log("=" .repeat(60));
