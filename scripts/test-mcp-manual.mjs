#!/usr/bin/env node
/**
 * 手动测试 MCP 服务器
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log("启动 MCP 服务器测试...\n");

const child = spawn("node", [path.join(__dirname, "mcp-excel-server-simple.mjs")], {
  stdio: ["pipe", "pipe", "inherit"], // stdin, stdout, stderr
});

// 读取服务器响应
let buffer = Buffer.alloc(0);
let step = 0;

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
      console.log("收到:", JSON.stringify(msg, null, 2));
      
      // 收到 initialize 响应后，发送 tools/list
      if (step === 0 && msg.result?.protocolVersion) {
        step = 1;
        console.log("\n发送 notifications/initialized...");
        const notify = {
          jsonrpc: "2.0",
          method: "notifications/initialized",
        };
        sendMessage(notify);
        
        setTimeout(() => {
          console.log("\n发送 tools/list...");
          const listReq = {
            jsonrpc: "2.0",
            id: 2,
            method: "tools/list",
          };
          sendMessage(listReq);
        }, 500);
      }
      
      // 收到 tools/list 响应后退出
      if (msg.result?.tools && msg.id === 2) {
        console.log(`\n✓ 测试成功! 发现 ${msg.result.tools.length} 个工具:`);
        msg.result.tools.forEach(t => {
          console.log(`  - ${t.name}: ${t.description?.slice(0, 60)}...`);
        });
        
        setTimeout(() => {
          child.kill();
          process.exit(0);
        }, 500);
      }
    } catch (err) {
      console.log("解析错误:", err.message);
    }
  }
});

function sendMessage(msg) {
  const data = JSON.stringify(msg);
  const header = `Content-Length: ${Buffer.byteLength(data)}\r\n\r\n`;
  child.stdin.write(header + data);
  console.log("发送:", JSON.stringify(msg, null, 2));
}

// 5秒后超时
setTimeout(() => {
  console.log("\n✗ 测试超时");
  child.kill();
  process.exit(1);
}, 10000);

// 发送 initialize
setTimeout(() => {
  console.log("发送 initialize...");
  const initReq = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test", version: "1.0" },
    },
  };
  sendMessage(initReq);
}, 1000);
