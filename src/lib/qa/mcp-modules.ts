import { prisma } from "@/lib/prisma";
import type { QaSkillModeHint } from "@/lib/qa/skills-catalog";

export type QaMcpTransport = "streamable_http";

export type QaMcpModule = {
  id: number;
  moduleKey: string;
  label: string;
  description: string;
  transport: QaMcpTransport;
  endpointUrl: string;
  headers: Record<string, string>;
  keywordHints: string[];
  toolAllowlist: string[];
  modeHint: QaSkillModeHint;
  isEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type DbQaMcpModuleRow = {
  id: number;
  moduleKey: string;
  label: string;
  description: string;
  transport: string;
  endpointUrl: string;
  headers: unknown;
  keywordHints: unknown;
  toolAllowlist: unknown;
  modeHint: string;
  isEnabled: boolean | number;
  createdAt: Date;
  updatedAt: Date;
};

function isMissingMcpModuleTableError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("qamcpmodule") &&
    (message.includes("doesn't exist") ||
      message.includes("does not exist") ||
      message.includes("no such table") ||
      message.includes("unknown table"))
  );
}

function normalizeModeHint(value: string): QaSkillModeHint {
  const normalized = value.toLowerCase();
  if (normalized === "blog" || normalized === "web") {
    return normalized;
  }
  return "auto";
}

function normalizeTransport(value: string): QaMcpTransport {
  return value.toLowerCase() === "streamable_http" ? "streamable_http" : "streamable_http";
}

function normalizeBoolean(value: boolean | number): boolean {
  return value === true || value === 1;
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

function normalizeStringArray(value: unknown) {
  const parsed = parsePossiblyJson(value);
  if (Array.isArray(parsed)) {
    return parsed
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 50);
  }

  if (typeof parsed === "string") {
    return parsed
      .split(/[,\n]/g)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 50);
  }

  return [] as string[];
}

function normalizeHeaders(value: unknown) {
  const parsed = parsePossiblyJson(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {} as Record<string, string>;
  }

  const normalized: Record<string, string> = {};
  for (const [key, raw] of Object.entries(parsed)) {
    const headerKey = String(key || "").trim();
    if (!headerKey) continue;
    if (typeof raw !== "string" && typeof raw !== "number" && typeof raw !== "boolean") continue;
    normalized[headerKey] = String(raw);
  }
  return normalized;
}

function mapDbMcpModule(row: DbQaMcpModuleRow): QaMcpModule {
  return {
    id: row.id,
    moduleKey: row.moduleKey,
    label: row.label,
    description: row.description,
    transport: normalizeTransport(row.transport),
    endpointUrl: row.endpointUrl,
    headers: normalizeHeaders(row.headers),
    keywordHints: normalizeStringArray(row.keywordHints),
    toolAllowlist: normalizeStringArray(row.toolAllowlist),
    modeHint: normalizeModeHint(row.modeHint),
    isEnabled: normalizeBoolean(row.isEnabled),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function normalizeModuleKeyPart(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  if (normalized) {
    return normalized.slice(0, 60);
  }

  return Date.now().toString(36);
}

function toPositiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

async function nextAvailableModuleKey(baseKey: string) {
  for (let index = 0; index < 50; index += 1) {
    const candidate = index === 0 ? baseKey : `${baseKey}-${index + 1}`;
    const rows = await prisma.$queryRaw<Array<{ total: number | string | bigint }>>`
      SELECT COUNT(*) AS total
      FROM QaMcpModule
      WHERE moduleKey = ${candidate}
      LIMIT 1
    `;
    const total = toPositiveInteger(rows[0]?.total);
    if (total === 0) {
      return candidate;
    }
  }

  return `${baseKey}-${Date.now().toString(36)}`;
}

async function queryQaMcpModuleByKey(moduleKey: string) {
  const rows = await prisma.$queryRaw<DbQaMcpModuleRow[]>`
    SELECT
      id, moduleKey, label, description, transport, endpointUrl, headers, keywordHints, toolAllowlist,
      modeHint, isEnabled, createdAt, updatedAt
    FROM QaMcpModule
    WHERE moduleKey = ${moduleKey}
    LIMIT 1
  `;

  return rows[0] ? mapDbMcpModule(rows[0]) : null;
}

export async function listQaMcpModules(input: { enabledOnly?: boolean } = {}) {
  try {
    const rows = input.enabledOnly
      ? await prisma.$queryRaw<DbQaMcpModuleRow[]>`
          SELECT
            id, moduleKey, label, description, transport, endpointUrl, headers, keywordHints, toolAllowlist,
            modeHint, isEnabled, createdAt, updatedAt
          FROM QaMcpModule
          WHERE isEnabled = 1
          ORDER BY createdAt DESC, id DESC
        `
      : await prisma.$queryRaw<DbQaMcpModuleRow[]>`
          SELECT
            id, moduleKey, label, description, transport, endpointUrl, headers, keywordHints, toolAllowlist,
            modeHint, isEnabled, createdAt, updatedAt
          FROM QaMcpModule
          ORDER BY createdAt DESC, id DESC
        `;

    return rows.map(mapDbMcpModule);
  } catch (error) {
    if (isMissingMcpModuleTableError(error)) {
      return [] as QaMcpModule[];
    }
    throw error;
  }
}

export async function listEnabledQaMcpModules() {
  return listQaMcpModules({ enabledOnly: true });
}

export async function createQaMcpModule(input: {
  label: string;
  description: string;
  endpointUrl: string;
  headers?: Record<string, string>;
  keywordHints?: string[];
  toolAllowlist?: string[];
  modeHint: QaSkillModeHint;
  isEnabled?: boolean;
}) {
  const baseKey = `mcp-${normalizeModuleKeyPart(input.label)}`;
  const moduleKey = await nextAvailableModuleKey(baseKey);
  const isEnabled = input.isEnabled ?? true;

  const headersJson =
    input.headers && Object.keys(input.headers).length > 0 ? JSON.stringify(input.headers) : null;
  const keywordHintsJson =
    input.keywordHints && input.keywordHints.length > 0 ? JSON.stringify(input.keywordHints) : null;
  const toolAllowlistJson =
    input.toolAllowlist && input.toolAllowlist.length > 0 ? JSON.stringify(input.toolAllowlist) : null;

  await prisma.$executeRaw`
    INSERT INTO QaMcpModule (
      moduleKey, label, description, transport, endpointUrl, headers, keywordHints, toolAllowlist,
      modeHint, isEnabled, createdAt, updatedAt
    )
    VALUES (
      ${moduleKey},
      ${input.label},
      ${input.description},
      'STREAMABLE_HTTP',
      ${input.endpointUrl},
      ${headersJson},
      ${keywordHintsJson},
      ${toolAllowlistJson},
      ${input.modeHint.toUpperCase()},
      ${isEnabled ? 1 : 0},
      NOW(3),
      NOW(3)
    )
  `;

  const created = await queryQaMcpModuleByKey(moduleKey);
  if (!created) {
    throw new Error("Failed to create MCP module.");
  }

  return created;
}
