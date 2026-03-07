import { prisma } from "@/lib/prisma";
import type { QaTabularFileMeta } from "@/lib/qa/tabular-file";

export type QaFileRecord = {
  id: number;
  userId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  sheetMeta: QaTabularFileMeta | null;
  createdAt: Date;
  updatedAt: Date;
};

type DbQaFileRow = {
  id: number;
  userId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  sheetMeta: unknown;
  createdAt: Date;
  updatedAt: Date;
};

function isMissingQaFileTableError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("qafile") &&
    (message.includes("doesn't exist") ||
      message.includes("does not exist") ||
      message.includes("no such table") ||
      message.includes("unknown table"))
  );
}

function parsePossiblyJson(value: unknown) {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

function normalizeSheetMeta(value: unknown) {
  const parsed = parsePossiblyJson(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  return parsed as QaTabularFileMeta;
}

function mapDbRow(row: DbQaFileRow): QaFileRecord {
  return {
    id: row.id,
    userId: row.userId,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    storagePath: row.storagePath,
    sheetMeta: normalizeSheetMeta(row.sheetMeta),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function normalizePositiveInt(value: unknown, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.floor(numeric));
}

function normalizeFileIds(fileIds: number[]) {
  return Array.from(
    new Set(
      fileIds
        .map((value) => normalizePositiveInt(value, -1))
        .filter((value) => Number.isInteger(value) && value > 0),
    ),
  );
}

async function getQaFileById(id: number) {
  const rows = await prisma.$queryRaw<DbQaFileRow[]>`
    SELECT
      id, userId, fileName, mimeType, sizeBytes, storagePath, sheetMeta, createdAt, updatedAt
    FROM QaFile
    WHERE id = ${id}
    LIMIT 1
  `;

  return rows[0] ? mapDbRow(rows[0]) : null;
}

export async function createQaFileRecord(input: {
  userId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  sheetMeta: QaTabularFileMeta | null;
}) {
  const sheetMetaJson = input.sheetMeta ? JSON.stringify(input.sheetMeta) : null;
  await prisma.$executeRaw`
    INSERT INTO QaFile (
      userId, fileName, mimeType, sizeBytes, storagePath, sheetMeta, createdAt, updatedAt
    )
    VALUES (
      ${input.userId},
      ${input.fileName},
      ${input.mimeType},
      ${input.sizeBytes},
      ${input.storagePath},
      ${sheetMetaJson},
      NOW(3),
      NOW(3)
    )
  `;

  const row = await prisma.$queryRaw<Array<{ id: number | string | bigint }>>`
    SELECT id FROM QaFile
    WHERE userId = ${input.userId}
    ORDER BY id DESC
    LIMIT 1
  `;
  const id = normalizePositiveInt(row[0]?.id);
  if (!id) {
    throw new Error("Failed to persist uploaded file.");
  }

  const created = await getQaFileById(id);
  if (!created) {
    throw new Error("Failed to load uploaded file.");
  }

  return created;
}

export async function listQaFilesForUser(input: { userId: string; limit?: number }) {
  const limit = Math.max(1, Math.min(50, normalizePositiveInt(input.limit || 20, 20)));

  try {
    const rows = await prisma.$queryRaw<DbQaFileRow[]>`
      SELECT
        id, userId, fileName, mimeType, sizeBytes, storagePath, sheetMeta, createdAt, updatedAt
      FROM QaFile
      WHERE userId = ${input.userId}
      ORDER BY createdAt DESC, id DESC
      LIMIT ${limit}
    `;

    return rows.map(mapDbRow);
  } catch (error) {
    if (isMissingQaFileTableError(error)) {
      return [] as QaFileRecord[];
    }
    throw error;
  }
}

export async function deleteQaFileForUser(input: { userId: string; fileId: number }) {
  const fileId = normalizePositiveInt(input.fileId, -1);
  if (fileId <= 0) {
    return null;
  }
  const file = await getQaFileById(fileId);
  if (!file || file.userId !== input.userId) {
    return null;
  }
  await prisma.$executeRaw`DELETE FROM QaFile WHERE id = ${fileId} AND userId = ${input.userId}`;
  return { storagePath: file.storagePath, id: file.id };
}

export async function getQaFilesByIdsForUser(input: {
  userId: string;
  fileIds: number[];
  limit?: number;
}) {
  const normalizedIds = normalizeFileIds(input.fileIds);
  if (normalizedIds.length === 0) {
    return [] as QaFileRecord[];
  }

  const limit = Math.max(1, Math.min(20, normalizePositiveInt(input.limit || 10, 10)));
  const placeholders = normalizedIds.map(() => "?").join(",");
  const query = `
    SELECT
      id, userId, fileName, mimeType, sizeBytes, storagePath, sheetMeta, createdAt, updatedAt
    FROM QaFile
    WHERE userId = ? AND id IN (${placeholders})
    ORDER BY createdAt DESC, id DESC
    LIMIT ${limit}
  `;
  const rows = await prisma.$queryRawUnsafe<DbQaFileRow[]>(query, input.userId, ...normalizedIds);
  return rows.map(mapDbRow);
}

function sampleRowToText(row: Record<string, string>) {
  const pairs = Object.entries(row)
    .filter(([key]) => key.trim())
    .slice(0, 8)
    .map(([key, value]) => `${key}=${String(value || "").slice(0, 40)}`);
  return pairs.join("; ");
}

function describeSingleFile(file: QaFileRecord) {
  const lines: string[] = [];
  const sizeMb = (file.sizeBytes / (1024 * 1024)).toFixed(2);
  lines.push(`- fileId=${file.id}, fileName=${file.fileName}, size=${sizeMb}MB`);
  if (!file.sheetMeta || !Array.isArray(file.sheetMeta.sheets) || file.sheetMeta.sheets.length === 0) {
    lines.push("  - 未解析到工作表结构。");
    return lines.join("\n");
  }

  for (const sheet of file.sheetMeta.sheets.slice(0, 4)) {
    const columns = Array.isArray(sheet.columns) ? sheet.columns.slice(0, 16).join(", ") : "";
    lines.push(
      `  - sheet=${sheet.sheetName}, rowCount=${sheet.rowCount}, columns=${columns || "无可用列信息"}`,
    );
    const sampleRows = Array.isArray(sheet.sampleRows) ? sheet.sampleRows.slice(0, 2) : [];
    for (const sample of sampleRows) {
      lines.push(`    - sample: ${sampleRowToText(sample)}`);
    }
  }
  return lines.join("\n");
}

export function buildQaFileAttachmentContext(files: QaFileRecord[]) {
  if (!Array.isArray(files) || files.length === 0) {
    return "";
  }

  const lines = [
    "[Uploaded Tabular Files]",
    "以下是用户已上传并授权当前问题使用的数据文件概要。",
    "分析时必须明确引用 fileId 与 sheet 名称；如果信息不足，要先索取补充条件。",
  ];

  for (const file of files.slice(0, 6)) {
    lines.push(describeSingleFile(file));
  }

  lines.push(
    "如果用户要求图形展示，你可以输出 `chart` 代码块，格式为 JSON：",
    "```chart",
    '{"type":"bar|line","title":"图表标题","xAxis":["x1","x2"],"series":[{"name":"指标名","data":[1,2]}]}',
    "```",
  );

  return lines.join("\n");
}
