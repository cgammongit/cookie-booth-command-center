import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const nonce = `${process.pid}-${Date.now()}`;
const libUrl = new URL("../scripts/dr/lib.mjs", import.meta.url);
libUrl.searchParams.set("test", nonce);
const {
  PRODUCTION_DATABASE_ID,
  PRODUCTION_DATABASE_NAME,
  assertDatabaseName,
  assertRehearsalTarget,
  createBackupManifest,
  evaluateVerification,
  sanitizedVerificationOutput,
  sha256File,
} = await import(libUrl.href);
const backupUrl = new URL("../scripts/dr/backup-d1.mjs", import.meta.url);
backupUrl.searchParams.set("test", nonce);
const { buildBackupCommand, runBackup } = await import(backupUrl.href);
const restoreUrl = new URL("../scripts/dr/restore-d1-rehearsal.mjs", import.meta.url);
restoreUrl.searchParams.set("test", nonce);
const { buildRehearsalCommand, runRehearsal } = await import(restoreUrl.href);

const validSnapshot = JSON.parse(
  await readFile(new URL("./fixtures/dr-valid-snapshot.json", import.meta.url), "utf8"),
);

test("empty, malformed, broad, and production rehearsal targets are rejected", () => {
  for (const target of [
    "",
    "x",
    "../database",
    PRODUCTION_DATABASE_NAME,
    PRODUCTION_DATABASE_ID,
    "cookie-command-center-production",
    "ordinary-database",
  ]) {
    assert.throws(() => assertRehearsalTarget(target));
  }
  assert.equal(
    assertRehearsalTarget("cookie-command-center-dr-rehearsal"),
    "cookie-command-center-dr-rehearsal",
  );
  assert.throws(() => assertDatabaseName(""));
  assert.throws(() => assertDatabaseName("*"));
});

test("backup command requires an explicit remote database and safe output", () => {
  assert.deepEqual(buildBackupCommand("approved-source-db", "backups/export.sql"), [
    "wrangler",
    "d1",
    "export",
    "approved-source-db",
    "--remote",
    "--output",
    "backups/export.sql",
  ]);
  assert.throws(() => buildBackupCommand("", "backups/export.sql"));
});

test("backup metadata and SHA-256 checksum generation are deterministic", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ccc-dr-backup-"));
  const exportPath = join(directory, "fixture.d1-backup.sql");
  await writeFile(exportPath, "CREATE TABLE fixture(id INTEGER);\n", "utf8");
  const checksum = await sha256File(exportPath);
  assert.match(checksum, /^[0-9a-f]{64}$/);
  const manifest = createBackupManifest({
    databaseName: "approved-source-db",
    exportedAt: "2026-07-29T00:00:00.000Z",
    sourceCommit: "abc123",
    wranglerVersion: "4.114.0",
    exportPath,
    checksum,
  });
  assert.equal(manifest.exportFilename, "fixture.d1-backup.sql");
  assert.equal(manifest.sha256, checksum);
  assert.doesNotMatch(JSON.stringify(manifest), /token|cookie|authorization/i);
});

test("mocked export writes only SQL, checksum, and sanitized metadata", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ccc-dr-run-"));
  const result = await runBackup({
    database: "approved-source-db",
    outputDirectory: directory,
    execute: true,
    now: new Date("2026-07-29T00:00:00.000Z"),
    runner(_file, command) {
      const outputPath = command[command.indexOf("--output") + 1];
      writeFileSync(outputPath, "CREATE TABLE safe_fixture(id INTEGER);\n");
      return { status: 0 };
    },
    sourceCommitProvider: () => "abc123",
    wranglerVersionProvider: () => "4.114.0",
  });
  assert.equal(result.manifest.databaseName, "approved-source-db");
  assert.match(await readFile(`${result.exportPath}.sha256`, "utf8"), /^[0-9a-f]{64}/);
  assert.doesNotMatch(
    await readFile(`${result.exportPath}.manifest.json`, "utf8"),
    /secret[_-]?key|bearer /i,
  );
});

test("restore rehearsal executes only the explicit non-production target", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ccc-dr-restore-"));
  const sql = join(directory, "fixture.sql");
  await writeFile(sql, "CREATE TABLE fixture(id INTEGER);\n", "utf8");
  const target = "cookie-command-center-dr-rehearsal";
  assert.deepEqual(buildRehearsalCommand(target, sql).slice(0, 5), [
    "wrangler",
    "d1",
    "execute",
    target,
    "--remote",
  ]);
  let invoked;
  await runRehearsal({
    target,
    exportPath: sql,
    confirmation: `RESTORE_TO_${target}`,
    execute: true,
    runner(file, command) {
      invoked = { file, command };
      return { status: 0 };
    },
  });
  assert.equal(invoked.command[3], target);
  assert.equal(invoked.command.includes(PRODUCTION_DATABASE_NAME), false);
  await assert.rejects(() =>
    runRehearsal({
      target,
      exportPath: sql,
      confirmation: "wrong",
      execute: true,
      runner() {
        throw new Error("must not run");
      },
    }),
  );
});

test("verification detects missing tables, count mismatches, broken relationships, and inventory", () => {
  assert.equal(evaluateVerification(validSnapshot).ok, true);
  const broken = structuredClone(validSnapshot);
  broken.tables = broken.tables.filter((table) => table !== "sales");
  broken.counts.sales = 24;
  broken.issues.orphanMemberships = 1;
  broken.issues.negativeBoothInventory = 1;
  const result = evaluateVerification(broken, validSnapshot.counts);
  assert.equal(result.ok, false);
  assert.equal(result.failures.includes("missing_table:sales"), true);
  assert.equal(result.failures.includes("count_mismatch:sales"), true);
  assert.equal(result.failures.includes("integrity:orphanMemberships"), true);
  assert.equal(result.failures.includes("integrity:negativeBoothInventory"), true);
});

test("verification output contains aggregates only and backup paths are gitignored", async () => {
  const sensitive = structuredClone(validSnapshot);
  sensitive.email = "person@example.com";
  sensitive.address = "123 Private Street";
  sensitive.token = "secret-token";
  const output = sanitizedVerificationOutput(evaluateVerification(sensitive));
  assert.doesNotMatch(output, /person@example|Private Street|secret-token/);
  const gitignore = await readFile(new URL("../.gitignore", import.meta.url), "utf8");
  assert.match(gitignore, /\/backups\//);
  assert.match(gitignore, /\*\.d1-backup\.sql/);
});

test("tool sources contain no Time Travel restore, deployment, delete, or migration execution", async () => {
  const sources = await Promise.all(
    ["backup-d1.mjs", "restore-d1-rehearsal.mjs", "verify-d1-rehearsal.mjs"].map(
      (name) => readFile(new URL(`../scripts/dr/${name}`, import.meta.url), "utf8"),
    ),
  );
  const combined = sources.join("\n");
  assert.doesNotMatch(combined, /time-travel\s+restore/i);
  assert.doesNotMatch(combined, /wrangler["',\s]+deploy/i);
  assert.doesNotMatch(combined, /d1["',\s]+delete/i);
  assert.doesNotMatch(combined, /migrations["',\s]+apply/i);
});
