#!/usr/bin/env node
/**
 * 更新 Excel MCP 模块使用 npm 脚本启动
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
console.log("更新 Excel MCP 模块使用 npm 脚本启动");
console.log("=" .repeat(60));

// 使用 npm run 启动
const config = JSON.stringify({
  command: "npm",
  args: ["run", "mcp:excel:simple"],
  env: {},
  cwd: path.join(__dirname, "..")
});

console.log("\n新配置:", config);

// 更新数据库
const modules = await prisma.$queryRaw`
  SELECT id, moduleKey, label
  FROM QaMcpModule
  WHERE moduleKey LIKE '%excel%'
`;

console.log(`\n找到 ${modules.length} 个 Excel 模块\n`);

for (const m of modules) {
  console.log(`更新: ${m.moduleKey}`);
  
  await prisma.$executeRaw`
    UPDATE QaMcpModule
    SET connectionConfig = ${config}
    WHERE id = ${m.id}
  `;
  
  console.log("  ✓ 已更新\n");
}

// 验证
console.log("\n验证结果:");
const updated = await prisma.$queryRaw`
  SELECT moduleKey, connectionConfig
  FROM QaMcpModule
  WHERE moduleKey LIKE '%excel%'
`;

for (const m of updated) {
  console.log(`\n${m.moduleKey}:`);
  console.log("  command:", m.connectionConfig?.command);
  console.log("  args:", m.connectionConfig?.args?.join(' '));
  console.log("  cwd:", m.connectionConfig?.cwd);
}

await prisma.$disconnect();

console.log("\n" + "=" .repeat(60));
console.log("更新完成!");
console.log("=" .repeat(60));
