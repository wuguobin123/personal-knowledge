/**
 * 列出已注册的 MCP 模块（从数据库读取）
 * 使用: node scripts/list-mcp-modules.mjs
 * 或: npm run mcp:list
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { PrismaClient } from "@prisma/client";

function loadEnv() {
  const dir = process.cwd();
  for (const name of [".env", ".env.local"]) {
    const p = resolve(dir, name);
    if (!existsSync(p)) continue;
    try {
      const content = readFileSync(p, "utf8");
      content.split("\n").forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) return;
        const idx = trimmed.indexOf("=");
        if (idx <= 0) return;
        const key = trimmed.slice(0, idx).trim();
        let value = trimmed.slice(idx + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
          value = value.slice(1, -1);
        process.env[key] = value;
      });
    } catch (_) {}
  }
}

loadEnv();

const prisma = new PrismaClient();

async function main() {
  let rows;
  try {
    rows = await prisma.$queryRaw`
      SELECT id, moduleKey, label, description, transport, isEnabled, createdAt
      FROM QaMcpModule
      ORDER BY createdAt DESC, id DESC
    `;
  } catch (err) {
    const msg = err?.message ?? String(err);
    if (msg.includes("QaMcpModule") && (msg.includes("exist") || msg.includes("Unknown table"))) {
      console.log("当前没有 MCP 模块表或表为空。请先执行 db:migrate。");
      process.exit(0);
      return;
    }
    throw err;
  }

  if (!rows || rows.length === 0) {
    console.log("未找到已注册的 MCP 模块。");
    console.log("可在后台 /admin -> Q&A 助手 -> MCP 模块 中添加，或使用 scripts/setup-github-mcp.mjs 添加 GitHub MCP。");
    return;
  }

  console.log("已注册的 MCP 模块:\n");
  for (const row of rows) {
    const enabled = row.isEnabled === true || row.isEnabled === 1 ? "是" : "否";
    console.log(`  ${row.moduleKey}`);
    console.log(`    标签: ${row.label}`);
    console.log(`    描述: ${(row.description || "").slice(0, 60)}${(row.description || "").length > 60 ? "..." : ""}`);
    console.log(`    传输: ${row.transport}  启用: ${enabled}  创建: ${row.createdAt}`);
    console.log("");
  }
  console.log(`共 ${rows.length} 个模块。`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
