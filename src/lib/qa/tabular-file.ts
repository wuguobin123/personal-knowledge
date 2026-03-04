import path from "node:path";
import * as XLSX from "xlsx";

const MAX_SHEETS = 8;
const MAX_COLUMNS = 32;
const MAX_SAMPLE_ROWS = 5;
const MAX_CELL_CHARS = 120;

const SUPPORTED_TABULAR_EXTENSIONS = new Set([".xlsx", ".xls", ".csv"]);
const SUPPORTED_TABULAR_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel.sheet.macroenabled.12",
]);

export type QaTabularSheetProfile = {
  sheetName: string;
  rowCount: number;
  columns: string[];
  sampleRows: Record<string, string>[];
};

export type QaTabularFileMeta = {
  format: string;
  sheets: QaTabularSheetProfile[];
  warnings: string[];
  parsedAt: string;
};

function normalizeCellValue(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") {
    return value.replace(/\s+/g, " ").trim().slice(0, MAX_CELL_CHARS);
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

  return String(value).replace(/\s+/g, " ").trim().slice(0, MAX_CELL_CHARS);
}

function normalizeHeaderName(raw: unknown, index: number, used: Set<string>) {
  const baseName = normalizeCellValue(raw) || `column_${index + 1}`;
  let candidate = baseName.slice(0, 60) || `column_${index + 1}`;
  let offset = 1;
  while (used.has(candidate)) {
    candidate = `${baseName.slice(0, 50)}_${offset}`;
    offset += 1;
  }
  used.add(candidate);
  return candidate;
}

function toExt(fileName: string) {
  return path.extname(String(fileName || "")).toLowerCase();
}

export function isSupportedTabularFile(input: { fileName: string; mimeType?: string | null }) {
  const ext = toExt(input.fileName);
  if (SUPPORTED_TABULAR_EXTENSIONS.has(ext)) {
    return true;
  }

  const mimeType = String(input.mimeType || "").toLowerCase().trim();
  return mimeType ? SUPPORTED_TABULAR_MIME_TYPES.has(mimeType) : false;
}

function inferFormat(fileName: string) {
  const ext = toExt(fileName).replace(/^\./, "");
  return ext || "unknown";
}

export function parseTabularFileMeta(buffer: Buffer, fileName: string): QaTabularFileMeta {
  const warnings: string[] = [];
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellDates: true,
    raw: false,
    dense: true,
  });
  const sheetNames = workbook.SheetNames.slice(0, MAX_SHEETS);

  if (workbook.SheetNames.length > MAX_SHEETS) {
    warnings.push(`仅解析前 ${MAX_SHEETS} 个工作表。`);
  }

  const sheets: QaTabularSheetProfile[] = [];
  for (const sheetName of sheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) continue;

    const matrix = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
      header: 1,
      blankrows: false,
      defval: "",
      raw: false,
    });
    const normalizedRows = matrix.filter((row) => Array.isArray(row));
    if (normalizedRows.length === 0) {
      sheets.push({
        sheetName,
        rowCount: 0,
        columns: [],
        sampleRows: [],
      });
      continue;
    }

    const headerRow = normalizedRows[0] || [];
    const usedHeaders = new Set<string>();
    const allColumns = headerRow.map((value, index) => normalizeHeaderName(value, index, usedHeaders));
    const columns = allColumns.slice(0, MAX_COLUMNS);
    if (allColumns.length > MAX_COLUMNS) {
      warnings.push(`工作表「${sheetName}」列数较多，仅保留前 ${MAX_COLUMNS} 列。`);
    }

    const dataRows = normalizedRows.slice(1);
    const sampleRows: Record<string, string>[] = dataRows.slice(0, MAX_SAMPLE_ROWS).map((row) => {
      const mapped: Record<string, string> = {};
      for (let index = 0; index < columns.length; index += 1) {
        mapped[columns[index]] = normalizeCellValue(row[index]);
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
    format: inferFormat(fileName),
    sheets,
    warnings,
    parsedAt: new Date().toISOString(),
  };
}
