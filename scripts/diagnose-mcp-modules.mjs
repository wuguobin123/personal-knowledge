#!/usr/bin/env node
/**
 * MCP 模块诊断工具
 * 检查 MCP 模块配置和连接状态
 */

import { PrismaClient } from "@prisma/client";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import fs from "node:fs";

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

async function diagnose() {
  console.log("=" .repeat(70));
  console.log("MCP 模块诊断工具");
  console.log("=" .repeat(70));

  // 1. 检查数据库中的模块
  console.log("\n📊 1. 数据库中的 MCP 模块:");
  const modules = await prisma.$queryRaw`
    SELECT 
      id,
      moduleKey,
      label,
      transport,
      isEnabled,
      modeHint,
      JSON_EXTRACT(connectionConfig, '$.command') as cmd,
      JSON_EXTRACT(connectionConfig, '$.args') as args,
      keywordHints
    FROM QaMcpModule
    ORDER BY createdAt DESC
  `;

  if (modules.length === 0) {
    console.log("   ⚠️  数据库中没有 MCP 模块!");
    return;
  }

  console.log(`   共找到 ${modules.length} 个模块:\n`);
  
  for (const m of modules) {
    const status = m.isEnabled ? "✓ 启用" : "✗ 禁用";
    console.log(`   [${status}] ${m.moduleKey}`);
    console.log(`      名称: ${m.label}`);
    console.log(`      传输: ${m.transport}`);
    console.log(`      模式: ${m.modeHint}`);
    
    if (m.transport === 'STDIO') {
      try {
        const args = m.args ? JSON.parse(m.args) : [];
        console.log(`      命令: ${m.cmd} ${args.join(' ')}`);
      } catch {
        console.log(`      命令: ${m.cmd} ${m.args}`);
      }
    }
    
    // 检查关键词
    try {
      const hints = JSON.parse(m.keywordHints || '[]');
      console.log(`      关键词: ${hints.slice(0, 5).join(', ')}${hints.length > 5 ? '...' : ''}`);
      
      // 检查是否包含 Excel 相关关键词
      const hasExcelKeywords = hints.some(h => 
        ['excel', 'xlsx', 'csv', '表格'].includes(h.toLowerCase())
      );
      if (!hasExcelKeywords) {
        console.log(`      ⚠️  警告: 关键词中缺少 Excel 相关词汇!`);
      }
    } catch {
      console.log(`      关键词: (解析失败)`);
    }
    console.log();
  }

  // 2. 查找 Excel 相关模块
  console.log("\n🔍 2. Excel 相关模块检查:");
  const excelModules = modules.filter(m => 
    m.moduleKey.toLowerCase().includes('excel') ||
    m.label.toLowerCase().includes('excel') ||
    (() => {
      try {
        const hints = JSON.parse(m.keywordHints || '[]');
        return hints.some(h => ['excel', 'xlsx', 'csv'].includes(h.toLowerCase()));
      } catch { return false; }
    })()
  );

  if (excelModules.length === 0) {
    console.log("   ⚠️  没有找到 Excel 相关模块!");
    console.log("   请先运行: npm run mcp:excel:setup");
  } else {
    console.log(`   找到 ${excelModules.length} 个 Excel 相关模块`);
    
    for (const m of excelModules) {
      console.log(`\n   模块: ${m.moduleKey}`);
      
      if (!m.isEnabled) {
        console.log("   ⚠️  此模块已禁用!");
        continue;
      }

      // 3. 测试 STDIO 服务器启动
      if (m.transport === 'STDIO') {
        console.log("   测试 STDIO 服务器启动...");
        
        try {
          const args = JSON.parse(m.args || '[]');
          const scriptPath = path.join(__dirname, '..', args[0]);
          
          if (!fs.existsSync(scriptPath)) {
            console.log(`   ✗ 服务器脚本不存在: ${scriptPath}`);
            continue;
          }
          
          console.log(`   脚本路径: ${scriptPath}`);
          
          // 尝试启动服务器并获取工具列表
          const tools = await testStdioServer(scriptPath);
          
          if (tools.length > 0) {
            console.log(`   ✓ 服务器启动成功，发现 ${tools.length} 个工具:`);
            tools.forEach(t => console.log(`     - ${t.name}: ${t.description?.slice(0, 60) || '无描述'}...`));
          } else {
            console.log("   ✗ 服务器启动但未能获取工具列表");
          }
        } catch (error) {
          console.log(`   ✗ 服务器启动失败: ${error.message}`);
        }
      }
    }
  }

  // 4. 检查常见配置问题
  console.log("\n⚠️  3. 常见问题检查:");
  
  // 检查是否有重复模块
  const keys = modules.map(m => m.moduleKey);
  const duplicates = keys.filter((item, index) => keys.indexOf(item) !== index);
  if (duplicates.length > 0) {
    console.log(`   ⚠️  发现重复的 moduleKey: ${duplicates.join(', ')}`);
  } else {
    console.log("   ✓ 无重复模块");
  }
  
  // 检查连接配置
  const stdioModules = modules.filter(m => m.transport === 'STDIO');
  for (const m of stdioModules) {
    try {
      const config = JSON.parse(`{ "args": ${m.args || '[]'} }`);
      if (!config.args || config.args.length === 0) {
        console.log(`   ⚠️  ${m.moduleKey}: STDIO 缺少 args 配置`);
      }
    } catch {
      console.log(`   ⚠️  ${m.moduleKey}: connectionConfig 格式错误`);
    }
  }

  await prisma.$disconnect();
  
  console.log("\n" + "=" .repeat(70));
  console.log("诊断完成");
  console.log("=" .repeat(70));
}

// 测试 STDIO 服务器
function testStdioServer(scriptPath) {
  return new Promise((resolve, reject) => {
    const tools = [];
    let buffer = Buffer.alloc(0);
    let initReceived = false;
    
    const child = spawn("node", [scriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("服务器启动超时"));
    }, 30000);
    
    child.stdout.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      
      while (true) {
        const headerEndIndex = buffer.indexOf("\r\n\r\n");
        if (headerEndIndex < 0) break;
        
        const header = buffer.slice(0, headerEndIndex).toString("utf8");
        const matched = header.match(/content-length:\s*(\d+)/i);
        if (!matched) {
          buffer = Buffer.alloc(0);
          break;
        }
        
        const contentLength = Number(matched[1]);
        const bodyStart = headerEndIndex + 4;
        const bodyEnd = bodyStart + contentLength;
        
        if (buffer.length < bodyEnd) break;
        
        const bodyText = buffer.slice(bodyStart, bodyEnd).toString("utf8");
        buffer = buffer.slice(bodyEnd);
        
        try {
          const msg = JSON.parse(bodyText);
          
          // 等待 initialize 响应
          if (msg.result && msg.result.protocolVersion && !initReceived) {
            initReceived = true;
            // 发送 initialized 通知
            const notify = {
              jsonrpc: "2.0",
              method: "notifications/initialized",
            };
            child.stdin.write(`Content-Length: ${Buffer.byteLength(JSON.stringify(notify))}\r\n\r\n${JSON.stringify(notify)}`);
            
            // 发送 tools/list 请求
            const listReq = {
              jsonrpc: "2.0",
              id: 2,
              method: "tools/list",
            };
            child.stdin.write(`Content-Length: ${Buffer.byteLength(JSON.stringify(listReq))}\r\n\r\n${JSON.stringify(listReq)}`);
          }
          
          // 接收 tools/list 响应
          if (msg.result && msg.result.tools && msg.id === 2) {
            tools.push(...msg.result.tools);
            clearTimeout(timeout);
            child.kill();
            resolve(tools);
          }
        } catch {
          // 忽略解析错误
        }
      }
    });
    
    child.stderr.on("data", (data) => {
      const msg = data.toString();
      if (msg.includes("Error") || msg.includes("error")) {
        console.log(`   服务器错误: ${msg.slice(0, 200)}`);
      }
    });
    
    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    
    child.on("exit", (code) => {
      if (code !== 0 && code !== null && !initReceived) {
        clearTimeout(timeout);
        reject(new Error(`进程退出码: ${code}`));
      }
    });
    
    // 发送 initialize 请求
    const initReq = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "diagnose", version: "1.0" },
      },
    };
    
    setTimeout(() => {
      child.stdin.write(`Content-Length: ${Buffer.byteLength(JSON.stringify(initReq))}\r\n\r\n${JSON.stringify(initReq)}`);
    }, 500);
  });
}

diagnose().catch(console.error);
