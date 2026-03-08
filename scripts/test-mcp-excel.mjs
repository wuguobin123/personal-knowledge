#!/usr/bin/env node
/**
 * Excel MCP Server 测试脚本
 * 用于测试 STDIO 传输方式的 MCP 服务器
 * 
 * 使用方法:
 *   node scripts/test-mcp-excel.mjs
 * 
 * 或使用 MCP Inspector:
 *   npx @modelcontextprotocol/inspector node scripts/mcp-excel-server.mjs
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// MCP 消息封装
function createMessage(payload) {
  const body = JSON.stringify(payload);
  const length = Buffer.byteLength(body, "utf8");
  return `Content-Length: ${length}\r\n\r\n${body}`;
}

// 发送请求并等待响应
async function sendRequest(process, request) {
  return new Promise((resolve, reject) => {
    const id = request.id;
    let buffer = Buffer.alloc(0);
    
    const onData = (chunk) => {
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
          const response = JSON.parse(bodyText);
          if (response.id === id) {
            process.stdout.off("data", onData);
            process.stderr.off("data", onError);
            resolve(response);
            return;
          }
        } catch {
          // 忽略解析错误
        }
      }
    };
    
    const onError = (data) => {
      console.error("[Server Error]", data.toString());
    };
    
    process.stdout.on("data", onData);
    process.stderr.on("data", onError);
    
    // 设置超时
    setTimeout(() => {
      process.stdout.off("data", onData);
      process.stderr.off("data", onError);
      reject(new Error("请求超时"));
    }, 30000);
    
    // 发送请求
    process.stdin.write(createMessage(request));
  });
}

// 测试用例
async function runTests() {
  console.log("=" .repeat(60));
  console.log("Excel MCP Server 测试");
  console.log("=" .repeat(60));
  
  // 启动 MCP 服务器
  console.log("\n1. 启动 MCP 服务器...");
  const serverProcess = spawn("node", [path.join(__dirname, "mcp-excel-server.mjs")], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  
  serverProcess.on("error", (error) => {
    console.error("启动服务器失败:", error.message);
    process.exit(1);
  });
  
  // 等待服务器启动
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  try {
    // 测试 1: Initialize
    console.log("\n2. 测试 Initialize...");
    const initResponse = await sendRequest(serverProcess, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
      },
    });
    console.log("Initialize 响应:", JSON.stringify(initResponse, null, 2));
    
    // 发送 initialized 通知
    serverProcess.stdin.write(createMessage({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }));
    
    // 测试 2: List Tools
    console.log("\n3. 测试 List Tools...");
    const toolsResponse = await sendRequest(serverProcess, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    });
    console.log("可用工具:");
    toolsResponse.result?.tools?.forEach(tool => {
      console.log(`  - ${tool.name}: ${tool.description}`);
    });
    
    // 测试 3: 创建测试文件并测试 excel_profile
    console.log("\n4. 测试 excel_profile 工具...");
    
    // 创建测试 Excel 文件
    const testDir = path.join(process.cwd(), "storage", "qa-files");
    const testFilePath = path.join(testDir, "test-data.xlsx");
    
    // 使用 xlsx 创建测试文件
    const XLSX = await import("xlsx");
    const workbook = XLSX.utils.book_new();
    const data = [
      ["姓名", "年龄", "城市", "分数"],
      ["张三", 25, "北京", 85.5],
      ["李四", 30, "上海", 92.0],
      ["王五", 28, "广州", 78.5],
      ["赵六", 35, "深圳", 88.0],
    ];
    const worksheet = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
    
    // 确保目录存在
    await import("node:fs").then(fs => {
      fs.mkdirSync(testDir, { recursive: true });
      fs.mkdirSync(path.join(testDir, "manifest"), { recursive: true });
    });
    
    XLSX.writeFile(workbook, testFilePath);
    
    // 创建 manifest 文件
    const manifestPath = path.join(testDir, "manifest", "999.json");
    await import("node:fs/promises").then(fs => 
      fs.writeFile(manifestPath, JSON.stringify({
        id: 999,
        fileName: "test-data.xlsx",
        storagePath: testFilePath,
      }))
    );
    
    const profileResponse = await sendRequest(serverProcess, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "excel_profile",
        arguments: {
          fileId: 999,
        },
      },
    });
    console.log("excel_profile 结果:");
    console.log(profileResponse.result?.content?.[0]?.text || "无结果");
    
    // 测试 4: 测试 excel_read_sheet
    console.log("\n5. 测试 excel_read_sheet 工具...");
    const readResponse = await sendRequest(serverProcess, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "excel_read_sheet",
        arguments: {
          fileId: 999,
          limit: 10,
        },
      },
    });
    console.log("excel_read_sheet 结果:");
    console.log(readResponse.result?.content?.[0]?.text || "无结果");
    
    // 测试 5: 测试 excel_analyze
    console.log("\n6. 测试 excel_analyze 工具...");
    const analyzeResponse = await sendRequest(serverProcess, {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "excel_analyze",
        arguments: {
          fileId: 999,
          columns: ["年龄", "分数"],
        },
      },
    });
    console.log("excel_analyze 结果:");
    console.log(analyzeResponse.result?.content?.[0]?.text || "无结果");
    
    console.log("\n" + "=" .repeat(60));
    console.log("所有测试完成!");
    console.log("=" .repeat(60));
    
  } catch (error) {
    console.error("\n测试失败:", error.message);
  } finally {
    // 清理
    serverProcess.kill();
    
    // 删除测试文件
    try {
      const fs = await import("node:fs/promises");
      await fs.unlink(path.join(process.cwd(), "storage", "qa-files", "test-data.xlsx"));
      await fs.unlink(path.join(process.cwd(), "storage", "qa-files", "manifest", "999.json"));
    } catch {
      // 忽略清理错误
    }
  }
}

runTests();
