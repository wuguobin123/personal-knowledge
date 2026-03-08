/**
 * 添加免费可用的 MCP 工具到数据库，用于测试问答流程是否可正常调用 MCP。
 * 使用: node scripts/add-mcp-free-tools.mjs
 * 或: npm run mcp:add-free
 *
 * 会添加：
 * 1. MCP Everything - 官方演示服务器（echo、add、getTinyImage、printEnv 等）
 * 2. Fetch 测试 - 抓取网页转 Markdown（mcp-fetch-node）
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
const isWindows = process.platform === "win32";

const FREE_MODULES = [
  {
    moduleKey: "mcp-everything",
    label: "MCP Everything",
    description: "官方 MCP 演示服务器，提供 echo、add、getTinyImage、printEnv 等工具，用于测试协议与问答流程",
    transport: "STDIO",
    endpointUrl: "stdio://local",
    connectionConfig: isWindows
      ? { command: "cmd", args: ["/c", "npx", "-y", "@modelcontextprotocol/server-everything"], env: {} }
      : { command: "npx", args: ["-y", "@modelcontextprotocol/server-everything"], env: {} },
    keywordHints: [
      "echo",
      "add",
      "加法",
      "计算",
      "测试",
      "图片",
      "getTinyImage",
      "环境变量",
      "printEnv",
      "everything",
    ],
    toolAllowlist: [],
  },
  {
    moduleKey: "mcp-fetch-test",
    label: "Fetch 测试",
    description: "Fetch MCP - 抓取网页内容并转为 Markdown，用于测试 MCP 是否可用",
    transport: "STDIO",
    endpointUrl: "stdio://local",
    connectionConfig: isWindows
      ? { command: "cmd", args: ["/c", "npx", "-y", "mcp-fetch-node"], env: {} }
      : { command: "npx", args: ["-y", "mcp-fetch-node"], env: {} },
    keywordHints: ["fetch", "抓取", "网页", "url", "链接", "获取页面", "打开链接"],
    toolAllowlist: [],
  },
];

async function upsertModule(module) {
  const connectionConfig = JSON.stringify(module.connectionConfig);
  const keywordHints = JSON.stringify(module.keywordHints);
  const toolAllowlist = JSON.stringify(module.toolAllowlist || []);

  const existing = await prisma.$queryRaw`
    SELECT id FROM QaMcpModule WHERE moduleKey = ${module.moduleKey} LIMIT 1
  `;

  if (existing?.length > 0) {
    await prisma.$executeRaw`
      UPDATE QaMcpModule
      SET label = ${module.label}, description = ${module.description}, transport = ${module.transport},
          endpointUrl = ${module.endpointUrl}, connectionConfig = ${connectionConfig},
          keywordHints = ${keywordHints}, toolAllowlist = ${toolAllowlist}, updatedAt = NOW(3)
      WHERE moduleKey = ${module.moduleKey}
    `;
    return { action: "updated", moduleKey: module.moduleKey, label: module.label };
  }

  await prisma.$executeRaw`
    INSERT INTO QaMcpModule (
      moduleKey, label, description, transport, endpointUrl, headers, connectionConfig, keywordHints, toolAllowlist,
      modeHint, isEnabled, createdAt, updatedAt
    )
    VALUES (
      ${module.moduleKey},
      ${module.label},
      ${module.description},
      ${module.transport},
      ${module.endpointUrl},
      null,
      ${connectionConfig},
      ${keywordHints},
      ${toolAllowlist},
      'AUTO',
      1,
      NOW(3),
      NOW(3)
    )
  `;
  return { action: "created", moduleKey: module.moduleKey, label: module.label };
}

async function main() {
  console.log("添加免费 MCP 工具到数据库...\n");

  for (const mod of FREE_MODULES) {
    const result = await upsertModule(mod);
    const icon = result.action === "created" ? "✅ 已添加" : "🔄 已更新";
    console.log(`${icon} ${result.label} (${result.moduleKey})`);
  }

  console.log("");
  console.log("验证方式:");
  console.log("  1. 后台 /admin → Q&A 助手 → MCP 模块 中查看并「测试连接」。");
  console.log("  2. 在 Q&A 中提问测试:");
  console.log("     - 「用 echo 工具回复 hello」或「计算 3 加 5」（走 MCP Everything）");
  console.log("     - 「抓取 https://example.com 的页面内容」或「fetch https://example.com」（走 Fetch）");
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
