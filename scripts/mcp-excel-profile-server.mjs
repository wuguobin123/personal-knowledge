#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import * as XLSX from "xlsx";

const MANIFEST_DIR = process.env.QA_FILES_MANIFEST_DIR || path.join(process.cwd(), "storage", "qa-files", "manifest");
const MAX_SHEETS = 8;
const MAX_COLUMNS = 24;
const MAX_SAMPLE_ROWS = 5;

function writeMessage(payload) {
  const body = JSON.stringify(payload);
  const length = Buffer.byteLength(body, "utf8");
  process.stdout.write(`Content-Length: ${length}\r\n\r\n${body}`);
}

function createError(id, code, message, data) {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      ...(data !== undefined ? { data } : {}),
    },
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
    .slice(0, MAX_COLUMNS)
    .map((value, index) => {
      const base = normalizeCell(value) || `column_${index + 1}`;
      let candidate = base.slice(0, 50);
      let suffix = 2;
      while (used.has(candidate)) {
        candidate = `${base.slice(0, 40)}_${suffix}`;
        suffix += 1;
      }
      used.add(candidate);
      return candidate;
    });
}

function profileWorkbook(buffer, preferredSheet) {
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellDates: true,
    raw: false,
    dense: true,
  });
  const sheetNames = preferredSheet
    ? workbook.SheetNames.filter((name) => name === preferredSheet).slice(0, 1)
    : workbook.SheetNames.slice(0, MAX_SHEETS);

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
    const sampleRows = dataRows.slice(0, MAX_SAMPLE_ROWS).map((row) => {
      const mapped = {};
      for (let index = 0; index < columns.length; index += 1) {
        mapped[columns[index]] = normalizeCell(row[index]);
      }
      return mapped;
    });
    sheets.push({
      sheetName,
      rowCount: Math.max(0, dataRows.length),
      columns,
      sampleRows,
    });
  }

  return {
    sheetCount: workbook.SheetNames.length,
    sheets,
  };
}

function parseFileIdFromQuery(query) {
  const matched = String(query || "").match(/fileId\s*[:=]\s*(\d+)/i);
  if (!matched) return null;
  const fileId = Number(matched[1]);
  return Number.isInteger(fileId) && fileId > 0 ? fileId : null;
}

async function resolveFilePath(argumentsPayload) {
  const args = argumentsPayload && typeof argumentsPayload === "object" ? argumentsPayload : {};
  const filePath = typeof args.filePath === "string" ? args.filePath.trim() : "";
  if (filePath) {
    return {
      filePath,
      fileId: null,
    };
  }

  const rawFileId = Number(args.fileId);
  const queryFileId = parseFileIdFromQuery(args.query);
  const fileId = Number.isInteger(rawFileId) && rawFileId > 0 ? rawFileId : queryFileId;
  if (!fileId) {
    throw new Error("Missing fileId/filePath. Example: {\"fileId\": 12}");
  }

  const manifestPath = path.join(MANIFEST_DIR, `${fileId}.json`);
  const manifestRaw = await fs.readFile(manifestPath, "utf8");
  const manifest = JSON.parse(manifestRaw);
  const manifestFilePath =
    manifest && typeof manifest === "object" && typeof manifest.storagePath === "string"
      ? manifest.storagePath.trim()
      : "";
  if (!manifestFilePath) {
    throw new Error(`Manifest is invalid for fileId=${fileId}.`);
  }

  return {
    filePath: manifestFilePath,
    fileId,
    fileName:
      manifest && typeof manifest === "object" && typeof manifest.fileName === "string"
        ? manifest.fileName
        : null,
  };
}

async function handleToolCall(params) {
  const payload = params && typeof params === "object" ? params : {};
  const toolName = typeof payload.name === "string" ? payload.name.trim() : "";
  if (toolName !== "excel_profile") {
    throw new Error(`Unsupported tool: ${toolName}`);
  }

  const resolved = await resolveFilePath(payload.arguments);
  const fileBuffer = await fs.readFile(resolved.filePath);
  const profile = profileWorkbook(fileBuffer, payload.arguments?.sheetName);

  const structured = {
    tool: "excel_profile",
    fileId: resolved.fileId || null,
    filePath: resolved.filePath,
    fileName: resolved.fileName || path.basename(resolved.filePath),
    ...profile,
  };

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(structured, null, 2),
      },
    ],
    structuredContent: structured,
    isError: false,
  };
}

async function handleRequest(request) {
  const method = request.method;
  if (method === "initialize") {
    return {
      protocolVersion: "2025-03-26",
      capabilities: {
        tools: {
          listChanged: false,
        },
      },
      serverInfo: {
        name: "local-excel-profile",
        version: "0.1.0",
      },
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
          description:
            "Read an uploaded Excel/CSV file and return sheet names, columns, row counts, and sample rows.",
          inputSchema: {
            type: "object",
            properties: {
              fileId: {
                type: "integer",
                description: "Uploaded file id from QA attachment context, e.g. 12",
              },
              filePath: {
                type: "string",
                description: "Absolute local path to the file. Optional when fileId is provided.",
              },
              sheetName: {
                type: "string",
                description: "Optional specific sheet name.",
              },
              query: {
                type: "string",
                description: "Original user question. Optional fallback for extracting fileId.",
              },
            },
            additionalProperties: true,
          },
        },
      ],
    };
  }

  if (method === "tools/call") {
    return handleToolCall(request.params);
  }

  throw new Error(`Unsupported method: ${method}`);
}

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
        writeMessage({
          jsonrpc: "2.0",
          id,
          result,
        });
      } else if (hasId && result === null) {
        writeMessage({
          jsonrpc: "2.0",
          id,
          result: {},
        });
      }
    } catch (error) {
      if (!hasId) continue;
      writeMessage(
        createError(
          id,
          -32000,
          error instanceof Error ? error.message : "Unhandled MCP server error.",
        ),
      );
    }
  }
});

process.stdin.resume();
