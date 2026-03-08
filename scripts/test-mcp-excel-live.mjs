#!/usr/bin/env node
/**
 * Excel MCP 实时测试
 * 模拟实际 QA 助手中的 MCP 调用流程
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

// MCP 客户端模拟
class McpTestClient {
  constructor(module) {
    this.module = module;
    this.process = null;
    this.buffer = Buffer.alloc(0);
    this.requestId = 0;
    this.pendingRequests = new Map();
    this.tools = [];
  }

  async connect() {
    return new Promise((resolve, reject) => {
      const config = this.module.connectionConfig;
      const cwd = config.cwd || process.cwd();
      
      console.log(`   启动进程: ${config.command} ${config.args.join(' ')}`);
      console.log(`   工作目录: ${cwd}`);

      this.process = spawn(config.command, config.args, {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, ...config.env },
      });

      const timeout = setTimeout(() => {
        this.process.kill();
        reject(new Error("连接超时 (30s)"));
      }, 30000);

      this.process.stdout.on("data", (chunk) => this.handleData(chunk));
      
      this.process.stderr.on("data", (data) => {
        const msg = data.toString().trim();
        if (msg) console.log(`   [Server] ${msg}`);
      });

      this.process.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      this.process.on("exit", (code) => {
        if (code !== 0 && code !== null) {
          console.log(`   进程退出码: ${code}`);
        }
      });

      // 发送 initialize
      setTimeout(async () => {
        try {
          const result = await this.sendRequest("initialize", {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "test-client", version: "1.0" },
          });
          
          console.log(`   ✓ Initialize 成功: ${result.serverInfo?.name} v${result.serverInfo?.version}`);
          
          // 发送 initialized 通知
          this.sendNotification("notifications/initialized");
          
          clearTimeout(timeout);
          resolve();
        } catch (err) {
          clearTimeout(timeout);
          reject(err);
        }
      }, 500);
    });
  }

  async listTools() {
    const result = await this.sendRequest("tools/list");
    this.tools = result.tools || [];
    return this.tools;
  }

  async callTool(name, args) {
    return this.sendRequest("tools/call", { name, arguments: args });
  }

  sendRequest(method, params) {
    return new Promise((resolve, reject) => {
      this.requestId++;
      const id = this.requestId;
      
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`请求超时: ${method}`));
      }, 30000);

      this.pendingRequests.set(id, {
        resolve: (result) => {
          clearTimeout(timeout);
          resolve(result);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
      });

      const message = {
        jsonrpc: "2.0",
        id,
        method,
        params,
      };

      const data = JSON.stringify(message);
      const header = `Content-Length: ${Buffer.byteLength(data)}\r\n\r\n`;
      
      this.process.stdin.write(header + data);
    });
  }

  sendNotification(method, params) {
    const message = {
      jsonrpc: "2.0",
      method,
      params,
    };
    const data = JSON.stringify(message);
    const header = `Content-Length: ${Buffer.byteLength(data)}\r\n\r\n`;
    this.process.stdin.write(header + data);
  }

  handleData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (true) {
      const headerEndIndex = this.buffer.indexOf("\r\n\r\n");
      if (headerEndIndex < 0) break;

      const header = this.buffer.slice(0, headerEndIndex).toString("utf8");
      const matched = header.match(/content-length:\s*(\d+)/i);
      if (!matched) {
        this.buffer = Buffer.alloc(0);
        break;
      }

      const contentLength = Number(matched[1]);
      const bodyStart = headerEndIndex + 4;
      const bodyEnd = bodyStart + contentLength;

      if (this.buffer.length < bodyEnd) break;

      const bodyText = this.buffer.slice(bodyStart, bodyEnd).toString("utf8");
      this.buffer = this.buffer.slice(bodyEnd);

      try {
        const msg = JSON.parse(bodyText);
        
        if (msg.id !== undefined) {
          const pending = this.pendingRequests.get(msg.id);
          if (pending) {
            this.pendingRequests.delete(msg.id);
            if (msg.error) {
              pending.reject(new Error(msg.error.message));
            } else {
              pending.resolve(msg.result);
            }
          }
        }
      } catch {
        // ignore
      }
    }
  }

  disconnect() {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }
}

async function testLive() {
  console.log("=" .repeat(70));
  console.log("Excel MCP 实时测试");
  console.log("=" .repeat(70));

  // 1. 从数据库获取 Excel 模块
  console.log("\n📊 1. 从数据库获取 Excel 模块...");
  const modules = await prisma.$queryRaw`
    SELECT 
      id,
      moduleKey,
      label,
      transport,
      connectionConfig,
      keywordHints
    FROM QaMcpModule
    WHERE isEnabled = 1 AND (moduleKey LIKE '%excel%' OR label LIKE '%Excel%')
  `;

  if (modules.length === 0) {
    console.log("   ✗ 没有找到启用的 Excel 模块!");
    console.log("   请先运行: npm run mcp:excel:setup");
    await prisma.$disconnect();
    return;
  }

  console.log(`   找到 ${modules.length} 个 Excel 模块`);

  // 解析配置
  for (const m of modules) {
    // Prisma 已经自动将 JSON 字段解析为对象
    if (typeof m.connectionConfig === 'string') {
      try {
        m.connectionConfig = JSON.parse(m.connectionConfig);
      } catch {
        console.log(`   ✗ ${m.moduleKey}: connectionConfig 格式错误`);
        continue;
      }
    } else if (typeof m.connectionConfig !== 'object') {
      console.log(`   ✗ ${m.moduleKey}: connectionConfig 类型错误`);
      continue;
    }

    console.log(`\n   模块: ${m.moduleKey}`);
    console.log(`   名称: ${m.label}`);
    
    // 2. 测试连接
    console.log("\n   🔌 2. 测试连接...");
    const client = new McpTestClient(m);
    
    try {
      await client.connect();
      
      // 3. 获取工具列表
      console.log("\n   🛠️  3. 获取工具列表...");
      const tools = await client.listTools();
      
      if (tools.length === 0) {
        console.log("   ⚠️  没有发现工具");
      } else {
        console.log(`   ✓ 发现 ${tools.length} 个工具:`);
        tools.forEach(t => {
          console.log(`      - ${t.name}: ${t.description?.slice(0, 60) || '无描述'}...`);
        });
      }

      // 4. 测试调用（创建测试文件）
      console.log("\n   🧪 4. 测试工具调用...");
      
      // 创建测试 Excel 文件
      const testDir = path.join(process.cwd(), "storage", "qa-files");
      const testFilePath = path.join(testDir, "test-students.xlsx");
      
      try {
        const XLSX = await import("xlsx");
        const workbook = XLSX.utils.book_new();
        const data = [
          ["编号", "姓名", "班级", "成绩"],
          ["104013", "武**", "一年级1班", 95],
          ["104014", "张三", "一年级1班", 88],
          ["104015", "李四", "一年级2班", 92],
        ];
        const worksheet = XLSX.utils.aoa_to_sheet(data);
        XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
        
        fs.mkdirSync(testDir, { recursive: true });
        fs.mkdirSync(path.join(testDir, "manifest"), { recursive: true });
        XLSX.writeFile(workbook, testFilePath);
        
        // 创建 manifest
        const manifestPath = path.join(testDir, "manifest", "888.json");
        fs.writeFileSync(manifestPath, JSON.stringify({
          id: 888,
          fileName: "test-students.xlsx",
          storagePath: testFilePath,
        }));

        // 测试 excel_profile
        if (tools.find(t => t.name === "excel_profile")) {
          console.log("   测试 excel_profile...");
          const result = await client.callTool("excel_profile", {
            fileId: 888,
          });
          
          const text = result.content?.[0]?.text || JSON.stringify(result);
          const parsed = JSON.parse(text);
          console.log(`   ✓ 成功! 工作表: ${parsed.sheets?.[0]?.sheetName}, 行数: ${parsed.sheets?.[0]?.rowCount}`);
        }

        // 清理测试文件
        fs.unlinkSync(testFilePath);
        fs.unlinkSync(manifestPath);
        
      } catch (err) {
        console.log(`   ⚠️  工具调用测试失败: ${err.message}`);
      }

      client.disconnect();
      console.log("\n   ✓ 测试完成");
      
    } catch (err) {
      console.log(`   ✗ 连接失败: ${err.message}`);
      client.disconnect();
    }
  }

  await prisma.$disconnect();
  
  console.log("\n" + "=" .repeat(70));
  console.log("测试完成");
  console.log("=" .repeat(70));
}

testLive().catch(err => {
  console.error("测试失败:", err);
  process.exit(1);
});
