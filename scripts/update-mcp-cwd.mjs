#!/usr/bin/env node
/**
 * 更新 Excel MCP 模块的 cwd 为绝对路径
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

const projectRoot = path.join(__dirname, "..");
console.log("项目根目录:", projectRoot);

// 更新配置
const correctConfig = JSON.stringify({
  command: "node",
  args: [path.join(projectRoot, "scripts/mcp-excel-server.mjs")],
  env: {},
  cwd: projectRoot
});

console.log("\n新配置:", correctConfig);

const result = await prisma.$executeRaw`
  UPDATE QaMcpModule
  SET connectionConfig = ${correctConfig}
  WHERE moduleKey LIKE '%excel%'
`;

console.log("\n更新完成:", result);

// 验证
const updated = await prisma.$queryRaw`
  SELECT moduleKey, connectionConfig
  FROM QaMcpModule
  WHERE moduleKey LIKE '%excel%'
`;

for (const m of updated) {
  console.log(`\n${m.moduleKey}:`);
  console.log("  config:", JSON.stringify(m.connectionConfig, null, 2));
}

await prisma.$disconnect();
