#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { access } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  assertRehearsalConfirmation,
  assertRehearsalTarget,
  requiredRehearsalConfirmation,
} from "./lib.mjs";

export function buildRehearsalCommand(target, exportPath) {
  assertRehearsalTarget(target);
  if (typeof exportPath !== "string" || !exportPath.endsWith(".sql")) {
    throw new Error("an explicit SQL export file is required");
  }
  return ["wrangler", "d1", "execute", target, "--remote", "--file", exportPath];
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
  const result = runner("npx", command, { stdio: "inherit", shell: true });
  if (result.status !== 0) throw new Error("rehearsal import failed");
  return { execute: true, target };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const value = (name) => args[args.indexOf(name) + 1];
  runRehearsal({
    target: value("--target"),
    exportPath: value("--file"),
    confirmation: value("--confirm"),
    execute: args.includes("--execute"),
  })
    .then((result) => {
      if (!result.execute) {
        console.log("Plan only; this script never creates or deletes a database.");
        console.log(["npx", ...result.command].join(" "));
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
