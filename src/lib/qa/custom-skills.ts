import { prisma } from "@/lib/prisma";
import {
  listQaSkills,
  type QaSkillModeHint,
  type QaSkillOption,
  type QaSkillSource,
} from "@/lib/qa/skills-catalog";

export type CustomQaSkill = {
  id: number;
  skillKey: string;
  label: string;
  description: string;
  instruction: string;
  modeHint: QaSkillModeHint;
  source: Exclude<QaSkillSource, "builtin">;
  githubUrl: string | null;
  stars: number | null;
  isEnabled: boolean;
};

type DbQaSkillRow = {
  id: number;
  skillKey: string;
  label: string;
  description: string;
  instruction: string;
  modeHint: string;
  source: string;
  githubUrl: string | null;
  stars: number | null;
  isEnabled: boolean | number;
};

function normalizeModeHint(value: string): QaSkillModeHint {
  const normalized = value.toLowerCase();
  if (normalized === "blog" || normalized === "web") {
    return normalized;
  }
  return "auto";
}

function normalizeSource(value: string): Exclude<QaSkillSource, "builtin"> {
  return value.toLowerCase() === "github" ? "github" : "manual";
}

function normalizeBoolean(value: boolean | number): boolean {
  return value === true || value === 1;
}

function mapDbSkill(row: DbQaSkillRow): CustomQaSkill {
  return {
    id: row.id,
    skillKey: row.skillKey,
    label: row.label,
    description: row.description,
    instruction: row.instruction,
    modeHint: normalizeModeHint(row.modeHint),
    source: normalizeSource(row.source),
    githubUrl: row.githubUrl ?? null,
    stars: Number.isFinite(row.stars) ? row.stars : null,
    isEnabled: normalizeBoolean(row.isEnabled),
  };
}

function toPositiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

function isMissingSkillTableError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("qaskill") &&
    (message.includes("doesn't exist") ||
      message.includes("does not exist") ||
      message.includes("no such table") ||
      message.includes("unknown table"))
  );
}

function normalizeSkillKeyPart(value: string) {
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

async function nextAvailableSkillKey(baseKey: string) {
  for (let index = 0; index < 50; index += 1) {
    const candidate = index === 0 ? baseKey : `${baseKey}-${index + 1}`;
    const rows = await prisma.$queryRaw<Array<{ total: number | string | bigint }>>`
      SELECT COUNT(*) AS total
      FROM QaSkill
      WHERE skillKey = ${candidate}
      LIMIT 1
    `;
    const total = toPositiveInteger(rows[0]?.total);
    if (total === 0) {
      return candidate;
    }
  }

  return `${baseKey}-${Date.now().toString(36)}`;
}

async function queryCustomSkillByKey(skillKey: string) {
  const rows = await prisma.$queryRaw<DbQaSkillRow[]>`
    SELECT
      id, skillKey, label, description, instruction, modeHint, source, githubUrl, stars, isEnabled
    FROM QaSkill
    WHERE skillKey = ${skillKey}
    LIMIT 1
  `;

  return rows[0] ? mapDbSkill(rows[0]) : null;
}

export async function listCustomQaSkills() {
  try {
    const rows = await prisma.$queryRaw<DbQaSkillRow[]>`
      SELECT
        id, skillKey, label, description, instruction, modeHint, source, githubUrl, stars, isEnabled
      FROM QaSkill
      WHERE isEnabled = 1
      ORDER BY createdAt DESC, id DESC
    `;

    return rows.map(mapDbSkill);
  } catch (error) {
    if (isMissingSkillTableError(error)) {
      return [] as CustomQaSkill[];
    }
    throw error;
  }
}

export async function getCustomQaSkill(skillKey: string) {
  try {
    return await queryCustomSkillByKey(skillKey);
  } catch (error) {
    if (isMissingSkillTableError(error)) {
      return null;
    }
    throw error;
  }
}

export function toQaSkillOption(customSkill: CustomQaSkill): QaSkillOption {
  return {
    id: customSkill.skillKey,
    label: customSkill.label,
    description: customSkill.description,
    modeHint: customSkill.modeHint,
    source: customSkill.source,
    githubUrl: customSkill.githubUrl,
    stars: customSkill.stars,
  };
}

export async function listQaSkillsWithCustom() {
  const customSkills = await listCustomQaSkills();
  return [...listQaSkills(), ...customSkills.map(toQaSkillOption)];
}

export async function createManualQaSkill(input: {
  label: string;
  description: string;
  instruction: string;
  modeHint: QaSkillModeHint;
}) {
  const baseKey = `custom-${normalizeSkillKeyPart(input.label)}`;
  const skillKey = await nextAvailableSkillKey(baseKey);

  await prisma.$executeRaw`
    INSERT INTO QaSkill (
      skillKey, label, description, instruction, modeHint, source, githubUrl, stars, isEnabled, createdAt, updatedAt
    )
    VALUES (
      ${skillKey},
      ${input.label},
      ${input.description},
      ${input.instruction},
      ${input.modeHint.toUpperCase()},
      'MANUAL',
      NULL,
      NULL,
      1,
      NOW(3),
      NOW(3)
    )
  `;

  const created = await queryCustomSkillByKey(skillKey);
  if (!created) {
    throw new Error("Failed to create custom skill.");
  }

  return created;
}

export function buildGithubSkillKey(owner: string, repo: string) {
  return `github-${normalizeSkillKeyPart(owner)}-${normalizeSkillKeyPart(repo)}`;
}

export async function createGithubQaSkill(input: {
  owner: string;
  repo: string;
  label: string;
  description: string;
  instruction: string;
  modeHint: QaSkillModeHint;
  githubUrl: string;
  stars: number | null;
}) {
  const skillKey = buildGithubSkillKey(input.owner, input.repo);
  const existing = await getCustomQaSkill(skillKey);
  if (existing) {
    return { created: false, skill: existing };
  }

  await prisma.$executeRaw`
    INSERT INTO QaSkill (
      skillKey, label, description, instruction, modeHint, source, githubUrl, stars, isEnabled, createdAt, updatedAt
    )
    VALUES (
      ${skillKey},
      ${input.label},
      ${input.description},
      ${input.instruction},
      ${input.modeHint.toUpperCase()},
      'GITHUB',
      ${input.githubUrl},
      ${input.stars},
      1,
      NOW(3),
      NOW(3)
    )
  `;

  const created = await queryCustomSkillByKey(skillKey);
  if (!created) {
    throw new Error("Failed to import GitHub skill.");
  }

  return { created: true, skill: created };
}
