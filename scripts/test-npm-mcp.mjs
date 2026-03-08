#!/usr/bin/env node
/**
 * 测试 npm 启动 MCP 服务器
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, "..");

console.log("测试 npm 启动 MCP 服务器...\n");
console.log("项目目录:", projectRoot);

const child = spawn("npm", ["run", "mcp:excel:manual"], {
  cwd: projectRoot,
  stdio: ["pipe", "pipe", "inherit"],
  shell: true, // Windows 需要 shell: true 来运行 npm
});

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
      console.log("\n收到:", JSON.stringify(msg, null, 2).slice(0, 500));
      
      if (step === 0 && msg.result?.protocolVersion) {
        step = 1;
        console.log("\n✓ Initialize 成功!");
        
        // 发送 initialized 通知
        const notify = { jsonrpc: "2.0", method: "notifications/initialized" };
        sendMsg(notify);
        
        // 发送 tools/list
        setTimeout(() => {
          const listReq = { jsonrpc: "2.0", id: 2, method: "tools/list" };
          sendMsg(listReq);
        }, 500);
      }
      
      if (msg.result?.tools && msg.id === 2) {
        console.log(`\n✓ 发现 ${msg.result.tools.length} 个工具:`);
        msg.result.tools.forEach(t => console.log(`  - ${t.name}`));
        
        setTimeout(() => {
          child.kill();
          process.exit(0);
        }, 500);
      }
    } catch (err) {
      // ignore
    }
  }
});

function sendMsg(msg) {
  const data = JSON.stringify(msg);
  const header = `Content-Length: ${Buffer.byteLength(data)}\r\n\r\n`;
  child.stdin.write(header + data);
}

// 超时
setTimeout(() => {
  console.log("\n✗ 测试超时");
  child.kill();
  process.exit(1);
}, 15000);

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
  sendMsg(initReq);
}, 2000);
