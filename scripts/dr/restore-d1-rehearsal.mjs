#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { access } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  assertRehearsalConfirmation,
  assertRehearsalTarget,
  npxExecutable,
  parseFlagValue,
  requiredRehearsalConfirmation,
} from "./lib.mjs";

export function buildRehearsalCommand(
  target,
  exportPath,
  platform = process.platform,
) {
  assertRehearsalTarget(target);
  if (typeof exportPath !== "string" || !exportPath.endsWith(".sql")) {
    throw new Error("an explicit SQL export file is required");
  }
  return {
    executable: npxExecutable(platform),
    args: [
      "--no-install",
      "wrangler",
      "d1",
      "execute",
      target,
      "--remote",
      "--file",
      exportPath,
    ],
  };
}

export function parseRehearsalArgs(argv) {
  return {
    target: parseFlagValue(argv, "--target", { required: true }),
    exportPath: parseFlagValue(argv, "--file", { required: true }),
    confirmation: parseFlagValue(argv, "--confirm"),
    execute: argv.includes("--execute"),
  };
}

export async function runRehearsal({
  target,
  exportPath,
  confirmation,
  execute,
  runner = spawnSync,
}) {
  assertRehearsalTarget(target);
  const command = buildRehearsalCommand(target, exportPath);
  if (!execute) {
    return {
      execute: false,
      command,
      requiredConfirmation: requiredRehearsalConfirmation(target),
    };
  }
  assertRehearsalConfirmation(target, confirmation);
  await access(exportPath);
  const result = runner(command.executable, command.args, { stdio: "inherit" });
  if (result.status !== 0) throw new Error("rehearsal import failed");
  return { execute: true, target };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  runRehearsal(parseRehearsalArgs(args))
    .then((result) => {
      if (!result.execute) {
        console.log("Plan only; this script never creates or deletes a database.");
        console.log(JSON.stringify(result.command, null, 2));
        console.log(`Execution requires: --execute --confirm ${result.requiredConfirmation}`);
      } else {
        console.log("Rehearsal import completed; run verification before declaring success.");
      }
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : "Rehearsal failed");
      process.exitCode = 1;
    });
}
