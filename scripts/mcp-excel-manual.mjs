#!/usr/bin/env node
/**
 * Excel MCP Server - 手动实现版（兼容原系统）
 */

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import * as XLSX from "xlsx";

const CONFIG = {
  MANIFEST_DIR: process.env.QA_FILES_MANIFEST_DIR || path.join(process.cwd(), "storage", "qa-files", "manifest"),
  MAX_SHEETS: 8,
  MAX_COLUMNS: 32,
  MAX_SAMPLE_ROWS: 5,
};

function writeMessage(payload) {
  const body = JSON.stringify(payload);
  const length = Buffer.byteLength(body, "utf8");
  process.stdout.write(`Content-Length: ${length}\r\n\r\n${body}`);
}

function createError(id, code, message) {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message },
  };
}

function normalizeCell(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.replace(/\s+/g, " ").trim().slice(0, 120);
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value instanceof Date) return value.toISOString();
  return String(value).replace(/\s+/g, " ").trim().slice(0, 120);
}

function normalizeColumns(headerRow) {
  const used = new Set();
  return headerRow
    .slice(0, CONFIG.MAX_COLUMNS)
    .map((value, index) => {
      const base = normalizeCell(value) || `column_${index + 1}`;
      let candidate = base.slice(0, 60);
      let suffix = 2;
      while (used.has(candidate)) {
        candidate = `${base.slice(0, 50)}_${suffix}`;
        suffix += 1;
      }
      used.add(candidate);
      return candidate;
    });
}

async function resolveFilePath(args) {
  const fileId = Number(args.fileId);
  if (!Number.isInteger(fileId) || fileId <= 0) {
    throw new Error("必须提供有效的 fileId 参数");
  }

  const manifestPath = path.join(CONFIG.MANIFEST_DIR, `${fileId}.json`);
  const manifestRaw = await fs.readFile(manifestPath, "utf8");
  const manifest = JSON.parse(manifestRaw);
  
  if (!manifest?.storagePath) {
    throw new Error(`文件 ID ${fileId} 的 manifest 无效`);
  }

  return {
    filePath: manifest.storagePath,
    fileId,
    fileName: manifest.fileName || null,
  };
}

function profileWorkbook(buffer) {
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellDates: true,
    raw: false,
    dense: true,
  });

  const sheets = [];
  for (const sheetName of workbook.SheetNames.slice(0, CONFIG.MAX_SHEETS)) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) continue;

    const matrix = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      blankrows: false,
      defval: "",
      raw: false,
    });

    const rows = Array.isArray(matrix) ? matrix.filter((item) => Array.isArray(item)) : [];
    const header = rows[0] || [];
    const columns = normalizeColumns(header);
    const dataRows = rows.slice(1);

    const sampleRows = dataRows.slice(0, CONFIG.MAX_SAMPLE_ROWS).map((row) => {
      const mapped = {};
      for (let index = 0; index < columns.length; index++) {
        mapped[columns[index]] = normalizeCell(row[index]);
      }
      return mapped;
    });

    sheets.push({
      sheetName,
      rowCount: Math.max(0, dataRows.length),
      columnCount: columns.length,
      columns,
      sampleRows,
    });
  }

  return {
    totalSheets: workbook.SheetNames.length,
    analyzedSheets: sheets.length,
    sheets,
  };
}

async function handleToolCall(params) {
  const toolName = params?.name;
  const args = params?.arguments || {};

  if (toolName !== "excel_profile") {
    throw new Error(`不支持的工具: ${toolName}`);
  }

  const resolved = await resolveFilePath(args);
  const buffer = await fs.readFile(resolved.filePath);
  const profile = profileWorkbook(buffer);

  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        tool: "excel_profile",
        fileId: resolved.fileId,
        filePath: resolved.filePath,
        fileName: resolved.fileName || path.basename(resolved.filePath),
        ...profile,
      }, null, 2),
    }],
    isError: false,
  };
}

async function handleRequest(request) {
  const method = request.method;
  
  if (method === "initialize") {
    return {
      protocolVersion: "2025-03-26",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "excel-analysis-server", version: "1.0.0" },
    };
  }

  if (method === "notifications/initialized") {
    return null;
  }

  if (method === "tools/list") {
    return {
      tools: [
        {
          name: "excel_profile",
          description: "获取 Excel/CSV 文件的结构信息，包括工作表名称、列名、行数和样本数据",
          inputSchema: {
            type: "object",
            properties: {
              fileId: { type: "integer", description: "上传文件的 ID" },
              sheetName: { type: "string", description: "指定要分析的工作表名称" },
            },
          },
        },
      ],
    };
  }

  if (method === "tools/call") {
    return handleToolCall(request.params);
  }

  throw new Error(`不支持的方法: ${method}`);
}

// 主循环
console.error("[Excel MCP Server] 启动中...");

let stdinBuffer = Buffer.alloc(0);
process.stdin.on("data", async (chunk) => {
  stdinBuffer = Buffer.concat([stdinBuffer, chunk]);

  while (true) {
    const headerEndIndex = stdinBuffer.indexOf("\r\n\r\n");
    if (headerEndIndex < 0) break;

    const header = stdinBuffer.slice(0, headerEndIndex).toString("utf8");
    const matched = header.match(/content-length:\s*(\d+)/i);
    if (!matched) {
      stdinBuffer = Buffer.alloc(0);
      break;
    }

    const contentLength = Number(matched[1]);
    const bodyStart = headerEndIndex + 4;
    const bodyEnd = bodyStart + contentLength;
    if (stdinBuffer.length < bodyEnd) break;

    const bodyText = stdinBuffer.slice(bodyStart, bodyEnd).toString("utf8");
    stdinBuffer = stdinBuffer.slice(bodyEnd);

    let request;
    try {
      request = JSON.parse(bodyText);
    } catch {
      continue;
    }

    const id = request?.id;
    const hasId = id !== undefined && id !== null;

    try {
      const result = await handleRequest(request);
      if (hasId && result !== null) {
        writeMessage({ jsonrpc: "2.0", id, result });
      } else if (hasId && result === null) {
        writeMessage({ jsonrpc: "2.0", id, result: {} });
      }
    } catch (error) {
      if (!hasId) continue;
      writeMessage(createError(id, -32000, error.message));
    }
  }
});

process.stdin.resume();
console.error("[Excel MCP Server] 已启动，等待连接...");
