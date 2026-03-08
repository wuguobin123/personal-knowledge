#!/usr/bin/env node
/**
 * Excel Analysis MCP Server
 * 基于 @modelcontextprotocol/sdk 的标准实现
 * 传输方式: STDIO
 * 
 * 提供工具:
 * - excel_profile: 获取 Excel/CSV 文件结构信息
 * - excel_read_sheet: 读取指定工作表的数据
 * - excel_analyze: 对数据进行统计分析
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { z } from "zod";
import * as XLSX from "xlsx";

// ============ 配置常量 ============
const CONFIG = {
  MANIFEST_DIR: process.env.QA_FILES_MANIFEST_DIR || path.join(process.cwd(), "storage", "qa-files", "manifest"),
  MAX_SHEETS: 8,
  MAX_COLUMNS: 32,
  MAX_SAMPLE_ROWS: 5,
  MAX_READ_ROWS: 1000,
  MAX_CELL_CHARS: 120,
};

// ============ 工具函数 ============

function normalizeCell(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") {
    return value.replace(/\s+/g, " ").trim().slice(0, CONFIG.MAX_CELL_CHARS);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value).replace(/\s+/g, " ").trim().slice(0, CONFIG.MAX_CELL_CHARS);
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

function parseFileIdFromQuery(query) {
  const matched = String(query || "").match(/fileId\s*[:=]\s*(\d+)/i);
  if (!matched) return null;
  const fileId = Number(matched[1]);
  return Number.isInteger(fileId) && fileId > 0 ? fileId : null;
}

async function resolveFilePath(args) {
  const filePath = typeof args.filePath === "string" ? args.filePath.trim() : "";
  if (filePath) {
    return { filePath, fileId: null };
  }

  const rawFileId = Number(args.fileId);
  const queryFileId = parseFileIdFromQuery(args.query);
  const fileId = Number.isInteger(rawFileId) && rawFileId > 0 ? rawFileId : queryFileId;
  
  if (!fileId) {
    throw new Error("必须提供 fileId 或 filePath 参数。示例: {\"fileId\": 12} 或 {\"filePath\": \"/path/to/file.xlsx\"}");
  }

  const manifestPath = path.join(CONFIG.MANIFEST_DIR, `${fileId}.json`);
  try {
    const manifestRaw = await fs.readFile(manifestPath, "utf8");
    const manifest = JSON.parse(manifestRaw);
    const manifestFilePath = manifest?.storagePath?.trim() || "";
    
    if (!manifestFilePath) {
      throw new Error(`文件 ID ${fileId} 的 manifest 无效，缺少 storagePath。`);
    }

    return {
      filePath: manifestFilePath,
      fileId,
      fileName: manifest?.fileName || null,
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`找不到文件 ID ${fileId} 的 manifest。`);
    }
    throw error;
  }
}

async function readWorkbook(filePath) {
  const buffer = await fs.readFile(filePath);
  return XLSX.read(buffer, {
    type: "buffer",
    cellDates: true,
    raw: false,
    dense: true,
  });
}

// ============ 核心功能 ============

function profileWorkbook(workbook, preferredSheet) {
  const sheetNames = preferredSheet
    ? workbook.SheetNames.filter((name) => name === preferredSheet).slice(0, 1)
    : workbook.SheetNames.slice(0, CONFIG.MAX_SHEETS);

  const sheets = [];
  for (const sheetName of sheetNames) {
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
      for (let index = 0; index < columns.length; index += 1) {
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

function readSheetData(workbook, sheetName, options = {}) {
  const { startRow = 0, limit = CONFIG.MAX_READ_ROWS, columns = null } = options;
  
  const targetSheetName = sheetName && workbook.SheetNames.includes(sheetName)
    ? sheetName
    : workbook.SheetNames[0];

  if (!targetSheetName) {
    throw new Error("工作簿中没有工作表");
  }

  const worksheet = workbook.Sheets[targetSheetName];
  const matrix = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    blankrows: false,
    defval: "",
    raw: false,
  });

  const rows = Array.isArray(matrix) ? matrix.filter((item) => Array.isArray(item)) : [];
  if (rows.length === 0) {
    return { sheetName: targetSheetName, columns: [], data: [], totalRows: 0 };
  }

  const headerRow = rows[0] || [];
  const allColumns = normalizeColumns(headerRow);
  const selectedColumns = columns 
    ? allColumns.filter(col => columns.includes(col))
    : allColumns;

  const dataRows = rows.slice(1);
  const slicedRows = dataRows.slice(startRow, startRow + limit);

  const data = slicedRows.map((row) => {
    const mapped = {};
    for (let index = 0; index < allColumns.length; index += 1) {
      if (!columns || columns.includes(allColumns[index])) {
        mapped[allColumns[index]] = normalizeCell(row[index]);
      }
    }
    return mapped;
  });

  return {
    sheetName: targetSheetName,
    columns: selectedColumns,
    data,
    totalRows: dataRows.length,
    returnedRows: data.length,
    startRow,
  };
}

function analyzeData(workbook, sheetName, analyzeColumns) {
  const targetSheetName = sheetName && workbook.SheetNames.includes(sheetName)
    ? sheetName
    : workbook.SheetNames[0];

  if (!targetSheetName) {
    throw new Error("工作簿中没有工作表");
  }

  const worksheet = workbook.Sheets[targetSheetName];
  const matrix = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    blankrows: false,
    defval: "",
    raw: false,
  });

  const rows = Array.isArray(matrix) ? matrix.filter((item) => Array.isArray(item)) : [];
  if (rows.length < 2) {
    return { sheetName: targetSheetName, error: "数据行数不足，无法进行分析" };
  }

  const headerRow = rows[0] || [];
  const columns = normalizeColumns(headerRow);
  const dataRows = rows.slice(1);

  // 确定要分析的列
  const targetColumns = analyzeColumns?.length > 0
    ? columns.filter(col => analyzeColumns.includes(col))
    : columns;

  const analysis = {};

  for (const col of targetColumns) {
    const colIndex = columns.indexOf(col);
    const values = dataRows.map(row => row[colIndex]).filter(v => v !== "" && v !== null && v !== undefined);
    const numericValues = values.map(v => Number(v)).filter(n => !isNaN(n));

    const stats = {
      totalCount: dataRows.length,
      nonEmptyCount: values.length,
      emptyCount: dataRows.length - values.length,
      uniqueValues: [...new Set(values.map(v => String(v)))].slice(0, 20),
      uniqueCount: new Set(values.map(v => String(v))).size,
    };

    // 数值分析
    if (numericValues.length > 0) {
      const sum = numericValues.reduce((a, b) => a + b, 0);
      const sorted = [...numericValues].sort((a, b) => a - b);
      const min = sorted[0];
      const max = sorted[sorted.length - 1];
      const avg = sum / numericValues.length;
      const median = sorted.length % 2 === 0
        ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
        : sorted[Math.floor(sorted.length / 2)];

      stats.type = "numeric";
      stats.numericStats = {
        min,
        max,
        avg: Number(avg.toFixed(4)),
        median: Number(median.toFixed(4)),
        sum: Number(sum.toFixed(4)),
        count: numericValues.length,
      };
    } else {
      stats.type = "text";
      stats.textStats = {
        avgLength: Number((values.reduce((sum, v) => sum + String(v).length, 0) / Math.max(values.length, 1)).toFixed(2)),
        maxLength: Math.max(...values.map(v => String(v).length), 0),
        sampleValues: values.slice(0, 5).map(v => String(v).slice(0, 50)),
      };
    }

    analysis[col] = stats;
  }

  return {
    sheetName: targetSheetName,
    totalRows: dataRows.length,
    columnCount: columns.length,
    analyzedColumns: targetColumns,
    analysis,
  };
}

// ============ MCP Server 初始化 ============

const server = new McpServer({
  name: "excel-analysis-server",
  version: "1.0.0",
  capabilities: {
    tools: {},
  },
});

// ============ 工具 1: excel_profile ============
server.tool(
  "excel_profile",
  "获取 Excel/CSV 文件的结构信息，包括工作表名称、列名、行数和样本数据。",
  {
    fileId: z.number().optional().describe("上传文件的 ID（从 QA 附件上下文中获取）"),
    filePath: z.string().optional().describe("文件的绝对路径（当提供 fileId 时可选）"),
    sheetName: z.string().optional().describe("指定要分析的工作表名称，不指定则分析所有工作表"),
    query: z.string().optional().describe("原始用户问题，用于提取 fileId（可选）"),
  },
  async (args) => {
    try {
      const resolved = await resolveFilePath(args);
      const workbook = await readWorkbook(resolved.filePath);
      const profile = profileWorkbook(workbook, args.sheetName);

      const result = {
        tool: "excel_profile",
        fileId: resolved.fileId,
        filePath: resolved.filePath,
        fileName: resolved.fileName || path.basename(resolved.filePath),
        ...profile,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `错误: ${error.message}` }],
        isError: true,
      };
    }
  }
);

// ============ 工具 2: excel_read_sheet ============
server.tool(
  "excel_read_sheet",
  "读取 Excel/CSV 文件中指定工作表的数据内容。",
  {
    fileId: z.number().optional().describe("上传文件的 ID"),
    filePath: z.string().optional().describe("文件的绝对路径"),
    sheetName: z.string().optional().describe("要读取的工作表名称，不指定则读取第一个工作表"),
    startRow: z.number().optional().default(0).describe("起始行索引（从 0 开始，0 表示从第一行数据开始）"),
    limit: z.number().optional().default(100).describe("要读取的最大行数（默认 100，最大 1000）"),
    columns: z.array(z.string()).optional().describe("要读取的列名列表，不指定则读取所有列"),
  },
  async (args) => {
    try {
      const resolved = await resolveFilePath(args);
      const workbook = await readWorkbook(resolved.filePath);
      
      const limit = Math.min(args.limit || 100, CONFIG.MAX_READ_ROWS);
      const data = readSheetData(workbook, args.sheetName, {
        startRow: args.startRow || 0,
        limit,
        columns: args.columns,
      });

      const result = {
        tool: "excel_read_sheet",
        fileId: resolved.fileId,
        fileName: resolved.fileName || path.basename(resolved.filePath),
        ...data,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `错误: ${error.message}` }],
        isError: true,
      };
    }
  }
);

// ============ 工具 3: excel_analyze ============
server.tool(
  "excel_analyze",
  "对 Excel/CSV 文件中的数据进行统计分析，包括数值统计（最大/最小/平均值）和文本统计。",
  {
    fileId: z.number().optional().describe("上传文件的 ID"),
    filePath: z.string().optional().describe("文件的绝对路径"),
    sheetName: z.string().optional().describe("要分析的工作表名称"),
    columns: z.array(z.string()).optional().describe("要分析的列名列表，不指定则分析所有列"),
  },
  async (args) => {
    try {
      const resolved = await resolveFilePath(args);
      const workbook = await readWorkbook(resolved.filePath);
      const analysis = analyzeData(workbook, args.sheetName, args.columns);

      const result = {
        tool: "excel_analyze",
        fileId: resolved.fileId,
        fileName: resolved.fileName || path.basename(resolved.filePath),
        ...analysis,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `错误: ${error.message}` }],
        isError: true,
      };
    }
  }
);

// ============ 启动服务器 ============

const transport = new StdioServerTransport();

console.error("[Excel MCP Server] 正在启动...");
console.error(`[Excel MCP Server] Manifest 目录: ${CONFIG.MANIFEST_DIR}`);

await server.connect(transport);

console.error("[Excel MCP Server] 已启动，等待连接...");
