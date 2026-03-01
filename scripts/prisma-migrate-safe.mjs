#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { PrismaClient } from "@prisma/client";

const prismaCli = resolvePrismaCli();
const rootDir = process.cwd();

function resolvePrismaCli() {
  const cliName = process.platform === "win32" ? "prisma.cmd" : "prisma";
  const localCli = path.resolve(process.cwd(), "node_modules", ".bin", cliName);
  return existsSync(localCli) ? localCli : cliName;
}

function runPrisma(args, captureOutput = true) {
  return spawnSync(prismaCli, args, {
    cwd: rootDir,
    env: process.env,
    encoding: "utf8",
    stdio: captureOutput ? "pipe" : "inherit",
  });
}

function printRunOutput(run) {
  if (run.stdout) process.stdout.write(run.stdout);
  if (run.stderr) process.stderr.write(run.stderr);
}

function parseFailedMigrationNames(text) {
  const names = new Set();
  const pattern = /The `([^`]+)` migration started at .* failed/g;
  let match = pattern.exec(text);
  while (match) {
    if (match[1]) names.add(match[1]);
    match = pattern.exec(text);
  }
  return Array.from(names);
}

function parseCreatedTables(sqlText) {
  const names = new Set();
  const pattern = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([A-Za-z0-9_]+)`?/gi;
  let match = pattern.exec(sqlText);
  while (match) {
    if (match[1]) names.add(match[1]);
    match = pattern.exec(sqlText);
  }
  return Array.from(names);
}

function toNumber(value) {
  if (typeof value === "bigint") return Number(value);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function doesTableExist(prisma, tableName) {
  const rows = await prisma.$queryRaw`
    SELECT COUNT(*) AS total
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ${tableName}
  `;
  return toNumber(rows[0]?.total) > 0;
}

async function inferResolveFlag(prisma, migrationName) {
  const migrationFile = path.resolve(
    rootDir,
    "prisma",
    "migrations",
    migrationName,
    "migration.sql",
  );

  if (!existsSync(migrationFile)) {
    return {
      flag: null,
      reason: `missing migration.sql for ${migrationName}`,
    };
  }

  const sqlText = readFileSync(migrationFile, "utf8");
  const createdTables = parseCreatedTables(sqlText);
  if (createdTables.length === 0) {
    return {
      flag: null,
      reason: "no CREATE TABLE statements found, requires manual check",
    };
  }

  const checks = await Promise.all(
    createdTables.map(async (tableName) => ({
      tableName,
      exists: await doesTableExist(prisma, tableName),
    })),
  );

  const existingCount = checks.filter((item) => item.exists).length;
  if (existingCount === checks.length) {
    return { flag: "--applied", reason: `all created tables exist (${createdTables.join(", ")})` };
  }
  if (existingCount === 0) {
    return { flag: "--rolled-back", reason: "none of the created tables exist" };
  }

  return {
    flag: null,
    reason: `partial objects found (${checks
      .map((item) => `${item.tableName}:${item.exists ? "exists" : "missing"}`)
      .join(", ")})`,
  };
}

async function resolveFailedMigrations() {
  const prisma = new PrismaClient();
  try {
    const failedRows = await prisma.$queryRaw`
      SELECT migration_name, started_at, finished_at, rolled_back_at, applied_steps_count, logs
      FROM _prisma_migrations
      WHERE finished_at IS NULL
        AND rolled_back_at IS NULL
      ORDER BY started_at ASC
    `;

    return failedRows.map((row) => String(row.migration_name));
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const firstRun = runPrisma(["migrate", "deploy"]);
  printRunOutput(firstRun);

  if (firstRun.status === 0) {
    process.exit(0);
  }

  const outputText = `${firstRun.stdout || ""}\n${firstRun.stderr || ""}`;
  if (!outputText.includes("P3009")) {
    process.exit(firstRun.status ?? 1);
  }

  console.error("[migrate-safe] Prisma P3009 detected. Attempting automatic recovery.");

  let migrationNames = [];
  try {
    migrationNames = await resolveFailedMigrations();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`[migrate-safe] Failed to read _prisma_migrations: ${reason}`);
  }

  if (migrationNames.length === 0) {
    migrationNames = parseFailedMigrationNames(outputText);
  }

  if (migrationNames.length === 0) {
    console.error("[migrate-safe] Could not identify failed migration names automatically.");
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    for (const migrationName of migrationNames) {
      const decision = await inferResolveFlag(prisma, migrationName);
      if (!decision.flag) {
        console.error(
          `[migrate-safe] ${migrationName}: unable to auto-resolve (${decision.reason}).`,
        );
        process.exit(1);
      }

      console.error(
        `[migrate-safe] Resolving ${migrationName} with ${decision.flag} (${decision.reason}).`,
      );
      const resolveRun = runPrisma(["migrate", "resolve", decision.flag, migrationName]);
      printRunOutput(resolveRun);
      if (resolveRun.status !== 0) {
        console.error(`[migrate-safe] prisma migrate resolve failed for ${migrationName}.`);
        process.exit(resolveRun.status ?? 1);
      }
    }
  } finally {
    await prisma.$disconnect();
  }

  console.error("[migrate-safe] Retrying prisma migrate deploy...");
  const retryRun = runPrisma(["migrate", "deploy"]);
  printRunOutput(retryRun);
  process.exit(retryRun.status ?? 1);
}

main().catch((error) => {
  const reason = error instanceof Error ? error.stack || error.message : String(error);
  console.error(`[migrate-safe] Unexpected failure: ${reason}`);
  process.exit(1);
});
