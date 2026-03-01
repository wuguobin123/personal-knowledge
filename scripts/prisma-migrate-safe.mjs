#!/usr/bin/env node

import { spawnSync } from "node:child_process";

function runPrisma(args) {
  return spawnSync("prisma", args, {
    encoding: "utf8",
    env: process.env,
  });
}

function printOutput(result) {
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
}

function extractMigrationName(output) {
  const byName = output.match(/Migration name:\s*([A-Za-z0-9_]+)/i);
  if (byName?.[1]) {
    return byName[1];
  }

  const byApplying = output.match(/Applying migration [`'"]([^`'"]+)[`'"]/i);
  if (byApplying?.[1]) {
    return byApplying[1];
  }

  return null;
}

function isTableExistsP3018(output) {
  return (
    /Error:\s*P3018/i.test(output) &&
    /Table\s+'.+'\s+already exists/i.test(output)
  );
}

const maxRetries = 10;
let retries = 0;

while (retries <= maxRetries) {
  const deployResult = runPrisma(["migrate", "deploy"]);
  printOutput(deployResult);

  if (deployResult.status === 0) {
    process.exit(0);
  }

  const output = `${deployResult.stdout ?? ""}\n${deployResult.stderr ?? ""}`;
  if (!isTableExistsP3018(output)) {
    process.exit(deployResult.status ?? 1);
  }

  const migrationName = extractMigrationName(output);
  if (!migrationName) {
    console.error(
      "Detected P3018 table-exists conflict but failed to parse migration name; aborting.",
    );
    process.exit(deployResult.status ?? 1);
  }

  console.error(
    `Detected existing table conflict for migration ${migrationName}, resolving as applied and retrying...`,
  );

  const resolveResult = runPrisma([
    "migrate",
    "resolve",
    "--applied",
    migrationName,
  ]);
  printOutput(resolveResult);

  if (resolveResult.status !== 0) {
    process.exit(resolveResult.status ?? 1);
  }

  retries += 1;
}

console.error(`Exceeded max migration conflict retries (${maxRetries}).`);
process.exit(1);
