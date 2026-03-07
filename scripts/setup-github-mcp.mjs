/**
 * GitHub MCP Server 配置脚本
 * 将 GitHub MCP 模块添加到数据库
 */

import { execSync } from "child_process";

// 从环境变量获取 GitHub Token
const githubToken = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;

if (!githubToken) {
  console.error("❌ 错误: 未设置 GITHUB_PERSONAL_ACCESS_TOKEN 环境变量");
  console.error("请在 .env.local 文件中添加:");
  console.error('GITHUB_PERSONAL_ACCESS_TOKEN=github_pat_xxx');
  process.exit(1);
}

// 检测操作系统
const isWindows = process.platform === "win32";

// 根据操作系统确定命令
const command = isWindows ? "cmd" : "npx";
const args = isWindows 
  ? ["/c", "npx", "-y", "@modelcontextprotocol/server-github"]
  : ["-y", "@modelcontextprotocol/server-github"];

// MCP 模块配置
const mcpModuleConfig = {
  label: "GitHub",
  description: "GitHub MCP Server - 用于访问 GitHub API，支持仓库、Issue、PR 等操作",
  transport: "stdio",
  endpointUrl: "stdio://local",
  headers: {},
  connectionConfig: {
    command,
    args,
    env: {
      GITHUB_PERSONAL_ACCESS_TOKEN: githubToken,
    },
  },
  keywordHints: [
    "github",
    "git",
    "仓库",
    "repository",
    "代码",
    "提交",
    "commit",
    "pr",
    "pull request",
    "issue",
    "分支",
    "branch",
    "merge",
    "代码审查",
  ],
  toolAllowlist: [], // 空数组表示允许所有工具
  modeHint: "auto",
  isEnabled: true,
};

console.log("🔧 GitHub MCP Server 配置信息:");
console.log(`   传输方式: ${mcpModuleConfig.transport}`);
console.log(`   命令: ${command}`);
console.log(`   参数: ${args.join(" ")}`);
console.log(`   Token: ${githubToken.slice(0, 10)}...${githubToken.slice(-4)}`);
console.log(`   操作系统: ${isWindows ? "Windows" : "Unix/Linux"}`);
console.log("");

// 构造 API 请求
const apiUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const endpoint = `${apiUrl}/api/admin/qa/mcp-modules`;

console.log(`🚀 正在添加 GitHub MCP 模块到数据库...`);
console.log(`   API 端点: ${endpoint}`);

try {
  // 首先尝试登录获取 session
  const loginPayload = {
    username: "admin",
    password: process.env.ADMIN_PASSWORD || "admin123",
  };

  console.log("   步骤 1: 登录获取会话...");
  
  const loginResponse = await fetch(`${apiUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(loginPayload),
  });

  if (!loginResponse.ok) {
    console.error("❌ 登录失败，请检查 ADMIN_PASSWORD 环境变量");
    process.exit(1);
  }

  // 获取 cookie
  const cookies = loginResponse.headers.get("set-cookie");
  if (!cookies) {
    console.error("❌ 未获取到 session cookie");
    process.exit(1);
  }

  console.log("   步骤 2: 创建 MCP 模块...");

  // 创建 MCP 模块
  const createResponse = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cookie": cookies,
    },
    body: JSON.stringify(mcpModuleConfig),
  });

  if (!createResponse.ok) {
    const error = await createResponse.json();
    console.error("❌ 创建 MCP 模块失败:");
    console.error(error);
    process.exit(1);
  }

  const result = await createResponse.json();
  console.log("✅ GitHub MCP 模块添加成功!");
  console.log("");
  console.log("📋 模块信息:");
  console.log(`   模块 Key: ${result.module.moduleKey}`);
  console.log(`   标签: ${result.module.label}`);
  console.log(`   传输: ${result.module.transport}`);
  console.log(`   状态: ${result.module.isEnabled ? "已启用" : "已禁用"}`);
  console.log("");
  console.log("💡 现在你可以在 Q&A 助手界面使用 GitHub 相关功能了");
  console.log("   示例问题:");
  console.log('   - "列出我的 GitHub 仓库"');
  console.log('   - "查看某仓库的 open issues"');
  console.log('   - "获取最新提交记录"');
  
} catch (error) {
  console.error("❌ 发生错误:", error.message);
  process.exit(1);
}
