/**
 * GitHub MCP Server 配置脚本（直接数据库操作）
 */

import { config } from "dotenv";

// 首先加载环境变量
config({ path: ".env.local" });

// 然后导入 Prisma
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// 从环境变量获取 GitHub Token
const githubToken = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;

if (!githubToken) {
  console.error("❌ 错误: 未设置 GITHUB_PERSONAL_ACCESS_TOKEN 环境变量");
  console.error("请在 .env.local 文件中添加:");
  console.error('GITHUB_PERSONAL_ACCESS_TOKEN=github_pat_xxx');
  process.exit(1);
}

// 检查数据库连接字符串
const dbUrl = process.env.DATABASE_URL;
console.log("📡 数据库连接:", dbUrl ? dbUrl.replace(/\/\/.*@/, '//***@') : "未设置");

// 检测操作系统
const isWindows = process.platform === "win32";

// 根据操作系统确定命令
const command = isWindows ? "cmd" : "npx";
const args = isWindows 
  ? ["/c", "npx", "-y", "@modelcontextprotocol/server-github"]
  : ["-y", "@modelcontextprotocol/server-github"];

// 关键字提示
const keywordHints = [
  "github", "git", "仓库", "repository", "代码", "提交", "commit",
  "pr", "pull request", "issue", "分支", "branch", "merge", "代码审查",
  "star", "fork", "clone", "release", "tag", "action", "workflow"
];

async function main() {
  console.log("🔧 GitHub MCP Server 配置信息:");
  console.log(`   传输方式: stdio`);
  console.log(`   命令: ${command}`);
  console.log(`   参数: ${args.join(" ")}`);
  console.log(`   Token: ${githubToken.slice(0, 10)}...${githubToken.slice(-4)}`);
  console.log(`   操作系统: ${isWindows ? "Windows" : "Unix/Linux"}`);
  console.log("");

  try {
    // 检查是否已存在 GitHub 模块
    const existing = await prisma.$queryRaw`
      SELECT id, moduleKey FROM QaMcpModule WHERE moduleKey LIKE 'mcp-github%' LIMIT 1
    `;

    if (existing && existing.length > 0) {
      console.log("⚠️  GitHub MCP 模块已存在，跳过创建");
      console.log(`   模块 Key: ${existing[0].moduleKey}`);
      return;
    }

    // 生成模块 key
    const moduleKey = `mcp-github-${Date.now().toString(36)}`;
    
    const now = new Date();
    const connectionConfigJson = JSON.stringify({
      command,
      args,
      env: {
        GITHUB_PERSONAL_ACCESS_TOKEN: githubToken,
      },
    });
    const keywordHintsJson = JSON.stringify(keywordHints);

    console.log("🚀 正在添加 GitHub MCP 模块到数据库...");

    // 插入数据库
    await prisma.$executeRaw`
      INSERT INTO QaMcpModule (
        moduleKey, label, description, transport, endpointUrl, 
        headers, connectionConfig, keywordHints, toolAllowlist,
        modeHint, isEnabled, createdAt, updatedAt
      )
      VALUES (
        ${moduleKey},
        ${"GitHub"},
        ${"GitHub MCP Server - 用于访问 GitHub API，支持仓库、Issue、PR 等操作"},
        ${"STDIO"},
        ${"stdio://local"},
        NULL,
        ${connectionConfigJson},
        ${keywordHintsJson},
        NULL,
        ${"AUTO"},
        ${1},
        ${now},
        ${now}
      )
    `;

    // 查询刚创建的模块
    const created = await prisma.$queryRaw`
      SELECT moduleKey, label, transport, isEnabled 
      FROM QaMcpModule 
      WHERE moduleKey = ${moduleKey}
      LIMIT 1
    `;

    console.log("✅ GitHub MCP 模块添加成功!");
    console.log("");
    console.log("📋 模块信息:");
    console.log(`   模块 Key: ${created[0].moduleKey}`);
    console.log(`   标签: ${created[0].label}`);
    console.log(`   传输: ${created[0].transport}`);
    console.log(`   状态: ${created[0].isEnabled ? "已启用" : "已禁用"}`);
    console.log("");
    console.log("💡 现在你可以在 Q&A 助手界面使用 GitHub 相关功能了");
    console.log("   示例问题:");
    console.log('   - "列出我的 GitHub 仓库"');
    console.log('   - "查看某个仓库的 open issues"');
    console.log('   - "获取仓库的最新提交记录"');
    console.log('   - "搜索关于 React 的热门仓库"');
    console.log("");
    console.log("🧪 测试连接:");
    console.log(`   你可以在后台管理页面的 Q&A Assistant -> MCP 模块中进行测试`);

  } catch (error) {
    console.error("❌ 发生错误:", error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
