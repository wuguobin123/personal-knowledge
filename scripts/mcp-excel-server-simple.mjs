#!/usr/bin/env node
/**
 * Excel MCP Server - 简化版（用于测试）
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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
  const rawFileId = Number(args.fileId);
  if (!Number.isInteger(rawFileId) || rawFileId <= 0) {
    throw new Error("必须提供有效的 fileId 参数");
  }

  const manifestPath = path.join(CONFIG.MANIFEST_DIR, `${rawFileId}.json`);
  const manifestRaw = await fs.readFile(manifestPath, "utf8");
  const manifest = JSON.parse(manifestRaw);
  
  if (!manifest?.storagePath) {
    throw new Error(`文件 ID ${rawFileId} 的 manifest 无效`);
  }

  return {
    filePath: manifest.storagePath,
    fileId: rawFileId,
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

// 创建服务器
const server = new McpServer({
  name: "excel-analysis-server",
  version: "1.0.0",
});

// 定义工具
server.tool(
  "excel_profile",
  "获取 Excel 文件结构信息",
  {
    fileId: { type: "number", description: "文件 ID" },
    sheetName: { type: "string", description: "工作表名称" },
  },
  async (args) => {
    try {
      const resolved = await resolveFilePath(args);
      const buffer = await fs.readFile(resolved.filePath);
      const profile = profileWorkbook(buffer);

      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify({
            tool: "excel_profile",
            fileId: resolved.fileId,
            fileName: resolved.fileName,
            ...profile,
          }, null, 2)
        }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `错误: ${error.message}` }],
        isError: true,
      };
    }
  }
);

// 启动服务器
const transport = new StdioServerTransport();

// 使用 stderr 输出日志
console.error("[Excel MCP] 启动中...");

await server.connect(transport);

console.error("[Excel MCP] 已启动");
