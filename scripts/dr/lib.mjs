import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

export const PRODUCTION_DATABASE_NAME = "cookie-booth-command-center-db";
export const PRODUCTION_DATABASE_ID =
  "086e7e3a-c155-49e7-99f5-ec34e8f195e6";

const DATABASE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{2,62}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REHEARSAL_MARKER = /(^|[-_])(dr|rehearsal|restore-test|sandbox|staging|test)([-_]|$)/i;
const PRODUCTION_MARKER = /(^|[-_])(prod|production)([-_]|$)/i;

export function npxExecutable(platform = process.platform) {
  return platform === "win32" ? "npx.cmd" : "npx";
}

export function parseFlagValue(
  argv,
  flag,
  { required = false, defaultValue } = {},
) {
  const positions = argv
    .map((value, index) => (value === flag ? index : -1))
    .filter((index) => index >= 0);
  if (positions.length > 1) throw new Error(`${flag} may be supplied only once`);
  if (!positions.length) {
    if (required) throw new Error(`${flag} requires an explicit value`);
    return defaultValue;
  }
  const value = argv[positions[0] + 1];
  if (value === undefined || value === "" || value.startsWith("--")) {
    throw new Error(`${flag} requires an explicit value`);
  }
  return value;
}

export function assertDatabaseName(value, label = "database") {
  if (typeof value !== "string" || !DATABASE_NAME.test(value)) {
    throw new Error(
      `${label} must be an explicit 3-63 character D1 name containing only letters, numbers, hyphens, or underscores`,
    );
  }
  return value;
}

export function assertSafeBackupDirectory(directory) {
  if (typeof directory !== "string" || !directory.trim()) {
    throw new Error("backup output directory is required");
  }
  const normalized = resolve(directory);
  const root = resolve(normalized).split(/[\\/]/)[0] + "\\";
  if (normalized === root || normalized.length < 6) {
    throw new Error("refusing broad backup output directory");
  }
  return normalized;
}

export function assertRehearsalTarget(target) {
  assertDatabaseName(target, "rehearsal target");
  if (
    target === PRODUCTION_DATABASE_NAME ||
    target.toLowerCase() === PRODUCTION_DATABASE_ID.toLowerCase() ||
    UUID.test(target) ||
    PRODUCTION_MARKER.test(target) ||
    !REHEARSAL_MARKER.test(target)
  ) {
    throw new Error(
      "target cannot be proven non-production; use an explicitly named rehearsal/test database",
    );
  }
  return target;
}

export function requiredRehearsalConfirmation(target) {
  return `RESTORE_TO_${target}`;
}

export function assertRehearsalConfirmation(target, confirmation) {
  const required = requiredRehearsalConfirmation(target);
  if (confirmation !== required) {
    throw new Error(`typed confirmation must exactly equal ${required}`);
  }
}

export function timestampForFilename(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

export async function sha256File(path) {
  const bytes = await readFile(path);
  return createHash("sha256").update(bytes).digest("hex");
}

export function createBackupManifest({
  databaseName,
  exportedAt,
  sourceCommit,
  wranglerVersion,
  exportPath,
  checksum,
}) {
  assertDatabaseName(databaseName);
  if (!/^[0-9a-f]{64}$/.test(checksum)) throw new Error("invalid SHA-256 checksum");
  return {
    databaseName,
    exportedAtUtc: new Date(exportedAt).toISOString(),
    sourceCommit,
    wranglerVersion,
    exportFilename: basename(exportPath),
    sha256: checksum,
    warning:
      "Sensitive operational data: encrypt at rest, restrict access, and never commit this export.",
  };
}

export const EXPECTED_TABLES = [
  "_cf_KV",
  "organizations",
  "users",
  "memberships",
  "organization_invitations",
  "booths",
  "assignments",
  "products",
  "inventory",
  "sales",
  "transactions",
  "reconciliations",
  "reconciliation_items",
  "troop_inventory_balances",
  "inventory_ledger",
  "access_audit_log",
  "booth_lifecycle_audit",
  "inventory_configuration_audit",
  "product_catalog_audit",
  "admin_alerts",
  "d1_migrations",
];

export const SAFE_COUNT_KEYS = [
  "organizations",
  "users",
  "memberships",
  "invitations",
  "booths",
  "assignments",
  "products",
  "boothInventory",
  "sales",
  "adjustments",
  "reconciliations",
  "reconciliationItems",
  "troopBalances",
  "inventoryLedger",
  "accessAudit",
  "lifecycleAudit",
  "inventoryAudit",
  "productAudit",
  "migrations",
];

export function evaluateVerification(snapshot, expectedCounts = null) {
  const failures = [];
  const tables = new Set(snapshot.tables || []);
  for (const table of EXPECTED_TABLES) {
    if (!tables.has(table)) failures.push(`missing_table:${table}`);
  }
  for (const key of SAFE_COUNT_KEYS) {
    if (!Number.isInteger(snapshot.counts?.[key]) || snapshot.counts[key] < 0) {
      failures.push(`invalid_count:${key}`);
    }
    if (
      expectedCounts &&
      Number.isInteger(expectedCounts[key]) &&
      snapshot.counts?.[key] !== expectedCounts[key]
    ) {
      failures.push(`count_mismatch:${key}`);
    }
  }
  const issueKeys = [
    "foreignKeyViolations",
    "orphanMemberships",
    "orphanBooths",
    "crossTenantProducts",
    "crossTenantInventory",
    "negativeTroopInventory",
    "negativeBoothInventory",
  ];
  for (const key of issueKeys) {
    if (snapshot.issues?.[key] !== 0) failures.push(`integrity:${key}`);
  }
  return {
    ok: failures.length === 0,
    failures,
    counts: Object.fromEntries(
      SAFE_COUNT_KEYS.map((key) => [key, Number(snapshot.counts?.[key] || 0)]),
    ),
  };
}

export function sanitizedVerificationOutput(result) {
  return JSON.stringify({
    ok: result.ok,
    failures: result.failures,
    counts: result.counts,
  }, null, 2);
}
