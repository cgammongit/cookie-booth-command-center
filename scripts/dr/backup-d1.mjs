#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertDatabaseName,
  assertSafeBackupDirectory,
  createBackupManifest,
  npxExecutable,
  parseFlagValue,
  sha256File,
  timestampForFilename,
} from "./lib.mjs";

export function parseBackupArgs(argv) {
  return {
    database: parseFlagValue(argv, "--database", { required: true }),
    outputDirectory: parseFlagValue(argv, "--output-dir", {
      defaultValue: "backups",
    }),
    execute: argv.includes("--execute"),
  };
}

export function buildBackupCommand(
  database,
  outputPath,
  platform = process.platform,
) {
  assertDatabaseName(database);
  return {
    executable: npxExecutable(platform),
    args: [
      "--no-install",
      "wrangler",
      "d1",
      "export",
      database,
      "--remote",
      "--output",
      outputPath,
    ],
  };
}

export async function runBackup({
  database,
  outputDirectory,
  execute,
  runner = spawnSync,
  now = new Date(),
  sourceCommitProvider = () =>
    execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  wranglerVersionProvider = () =>
    execFileSync(npxExecutable(), ["--no-install", "wrangler", "--version"], {
      encoding: "utf8",
    }).trim(),
}) {
  assertDatabaseName(database);
  const directory = assertSafeBackupDirectory(outputDirectory);
  const stamp = timestampForFilename(now);
  const exportPath = join(directory, `${database}-${stamp}.d1-backup.sql`);
  const command = buildBackupCommand(database, exportPath);
  if (!execute) return { execute: false, command, exportPath };

  await mkdir(directory, { recursive: true });
  const result = runner(command.executable, command.args, { stdio: "inherit" });
  if (result.status !== 0) throw new Error("Wrangler D1 export failed");
  const checksum = await sha256File(exportPath);
  const sourceCommit = sourceCommitProvider();
  const wranglerVersion = wranglerVersionProvider();
  const manifest = createBackupManifest({
    databaseName: database,
    exportedAt: now,
    sourceCommit,
    wranglerVersion,
    exportPath,
    checksum,
  });
  await writeFile(`${exportPath}.sha256`, `${checksum}  ${exportPath}\n`, "utf8");
  await writeFile(
    `${exportPath}.manifest.json`,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  return { execute: true, exportPath, manifest };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = parseBackupArgs(process.argv.slice(2));
  console.error(
    "WARNING: D1 exports contain sensitive operational data. Store encrypted and never commit them.",
  );
  runBackup(options)
    .then((result) => {
      if (!result.execute) {
        console.log("Plan only. Re-run with --execute after review:");
        console.log(JSON.stringify(result.command, null, 2));
      } else {
        console.log(`Export and checksum metadata created in ${options.outputDirectory}.`);
      }
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : "Backup failed");
      process.exitCode = 1;
    });
}
