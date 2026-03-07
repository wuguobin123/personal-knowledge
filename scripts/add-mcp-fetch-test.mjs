/**
 * 手动添加一个「Fetch」测试 MCP 模块到数据库，用于验证 MCP 是否可用。
 * 使用: node scripts/add-mcp-fetch-test.mjs
 * 或: npm run mcp:add-test
 *
 * 会添加 mcp-fetch-node（Node 版 Fetch MCP），
 * 问答时可让助手通过 fetch 工具抓取网页内容。
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { PrismaClient } from "@prisma/client";

// 从项目根目录加载 .env / .env.local，便于使用远程数据库
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

const MODULE_KEY = "mcp-fetch-test";
const isWindows = process.platform === "win32";

// stdio 命令：Windows 下用 cmd /c npx，否则直接 npx
// 使用 mcp-fetch-node（@modelcontextprotocol/server-fetch 不存在）
const command = isWindows ? "cmd" : "npx";
const args = isWindows
  ? ["/c", "npx", "-y", "mcp-fetch-node"]
  : ["-y", "mcp-fetch-node"];

const connectionConfig = JSON.stringify({
  command,
  args,
  env: {},
});
const keywordHints = JSON.stringify([
  "fetch",
  "抓取",
  "网页",
  "url",
  "链接",
  "获取页面",
  "打开链接",
]);
const toolAllowlist = JSON.stringify([]);

async function main() {
  const existing = await prisma.$queryRaw`
    SELECT id FROM QaMcpModule WHERE moduleKey = ${MODULE_KEY} LIMIT 1
  `;

  if (existing?.length > 0) {
    await prisma.$executeRaw`
      UPDATE QaMcpModule
      SET connectionConfig = ${connectionConfig}, updatedAt = NOW(3)
      WHERE moduleKey = ${MODULE_KEY}
    `;
    console.log("✅ 已更新 MCP 模块 " + MODULE_KEY + " 的 connectionConfig（修正为 mcp-fetch-node）");
    console.log("   命令: " + command + " " + args.join(" "));
  } else {
    const label = "Fetch 测试";
    const description = "Fetch MCP - 抓取网页内容并转为 Markdown，用于测试 MCP 是否可用";
    const transport = "STDIO";
    const endpointUrl = "stdio://local";
    const headers = null;
    const modeHint = "AUTO";
    const isEnabled = 1;

    await prisma.$executeRaw`
      INSERT INTO QaMcpModule (
        moduleKey, label, description, transport, endpointUrl, headers, connectionConfig, keywordHints, toolAllowlist,
        modeHint, isEnabled, createdAt, updatedAt
      )
      VALUES (
        ${MODULE_KEY},
        ${label},
        ${description},
        ${transport},
        ${endpointUrl},
        ${headers},
        ${connectionConfig},
        ${keywordHints},
        ${toolAllowlist},
        ${modeHint},
        ${isEnabled},
        NOW(3),
        NOW(3)
      )
    `;

    console.log("✅ 已添加 MCP 模块: Fetch 测试 (" + MODULE_KEY + ")");
    console.log("   传输: stdio，命令: " + command + " " + args.join(" "));
  }
  console.log("");
  console.log("验证方式:");
  console.log("  1. 在后台 /admin -> Q&A 助手 -> MCP 模块 中可看到该模块，可点击「测试连接」。");
  console.log("  2. 在 Q&A 中提问例如：「抓取 https://example.com 的页面内容摘要」或「fetch https://example.com」。");
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
