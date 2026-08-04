#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  assertRehearsalTarget,
  evaluateVerification,
  npxExecutable,
  parseFlagValue,
  sanitizedVerificationOutput,
} from "./lib.mjs";

export const TABLE_QUERY =
  "SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name";

export const AGGREGATE_QUERY = `
SELECT
  (SELECT COUNT(*) FROM organizations) AS organizations,
  (SELECT COUNT(*) FROM users) AS users,
  (SELECT COUNT(*) FROM memberships) AS memberships,
  (SELECT COUNT(*) FROM organization_invitations) AS invitations,
  (SELECT COUNT(*) FROM booths) AS booths,
  (SELECT COUNT(*) FROM assignments) AS assignments,
  (SELECT COUNT(*) FROM scouts) AS scouts,
  (SELECT COUNT(*) FROM booth_scout_assignments) AS scoutAssignments,
  (SELECT COUNT(*) FROM products) AS products,
  (SELECT COUNT(*) FROM inventory) AS boothInventory,
  (SELECT COUNT(*) FROM sales) AS sales,
  (SELECT COUNT(*) FROM sale_reversals) AS saleReversals,
  (SELECT COUNT(*) FROM transactions WHERE type IN ('adjustment','correction')) AS adjustments,
  (SELECT COUNT(*) FROM reconciliations) AS reconciliations,
  (SELECT COUNT(*) FROM reconciliation_items) AS reconciliationItems,
  (SELECT COUNT(*) FROM scout_sales_credits) AS scoutCredits,
  (SELECT COUNT(*) FROM troop_inventory_balances) AS troopBalances,
  (SELECT COUNT(*) FROM inventory_ledger) AS inventoryLedger,
  (SELECT COUNT(*) FROM access_audit_log) AS accessAudit,
  (SELECT COUNT(*) FROM booth_lifecycle_audit) AS lifecycleAudit,
  (SELECT COUNT(*) FROM inventory_configuration_audit) AS inventoryAudit,
  (SELECT COUNT(*) FROM product_catalog_audit) AS productAudit,
  (SELECT COUNT(*) FROM d1_migrations) AS migrations,
  (SELECT COUNT(*) FROM pragma_foreign_key_check) AS foreignKeyViolations,
  (SELECT COUNT(*) FROM memberships m
    LEFT JOIN organizations o ON o.id=m.organization_id
    LEFT JOIN users u ON u.id=m.user_id
    WHERE o.id IS NULL OR u.id IS NULL) AS orphanMemberships,
  (SELECT COUNT(*) FROM booths b
    LEFT JOIN organizations o ON o.id=b.organization_id
    WHERE o.id IS NULL) AS orphanBooths,
  (SELECT COUNT(*) FROM inventory i
    JOIN booths b ON b.id=i.booth_id
    JOIN products p ON p.id=i.product_id
    WHERE p.organization_id<>b.organization_id) AS crossTenantProducts,
  (SELECT COUNT(*) FROM troop_inventory_balances t
    JOIN products p ON p.id=t.product_id
    WHERE p.organization_id<>t.organization_id) AS crossTenantInventory,
  (SELECT COUNT(*) FROM troop_inventory_balances
    WHERE total_remaining<0 OR available<0 OR available>total_remaining) AS negativeTroopInventory,
  (SELECT COUNT(*) FROM inventory
    WHERE opening<0 OR sold<0 OR opening-sold+adjusted<0) AS negativeBoothInventory
  ,(SELECT COUNT(*) FROM scouts sc LEFT JOIN organizations o ON o.id=sc.organization_id
    WHERE o.id IS NULL) AS orphanScouts
  ,(SELECT COUNT(*) FROM booth_scout_assignments a
    LEFT JOIN booths b ON b.id=a.booth_id LEFT JOIN scouts sc ON sc.id=a.scout_id
    WHERE b.id IS NULL OR sc.id IS NULL OR a.organization_id<>b.organization_id OR a.organization_id<>sc.organization_id OR a.attendance_start>=a.attendance_end) AS invalidScoutAssignments
  ,(SELECT COUNT(*) FROM scout_sales_credits c
    LEFT JOIN booths b ON b.id=c.booth_id LEFT JOIN scouts sc ON sc.id=c.scout_id
    LEFT JOIN sales s ON s.id=c.sale_id LEFT JOIN transactions t ON t.id=c.transaction_id
    LEFT JOIN reconciliations r ON r.id=c.reconciliation_id
    WHERE b.id IS NULL OR sc.id IS NULL OR s.id IS NULL OR t.id IS NULL OR r.id IS NULL
      OR c.organization_id<>b.organization_id OR c.organization_id<>sc.organization_id
      OR s.booth_id<>c.booth_id OR t.sale_id<>c.sale_id OR c.credit_numerator<=0 OR c.credit_denominator<=0) AS invalidScoutCredits
  ,(SELECT COUNT(*) FROM sale_reversals sr
    LEFT JOIN sales s ON s.id=sr.sale_id LEFT JOIN booths b ON b.id=sr.booth_id
    LEFT JOIN users u ON u.id=sr.reversed_by_user_id
    WHERE s.id IS NULL OR b.id IS NULL OR u.id IS NULL OR s.booth_id<>sr.booth_id
      OR b.organization_id<>sr.organization_id) AS invalidSaleReversals
`.trim();

function rowsFromWranglerJson(output) {
  const parsed = JSON.parse(output);
  const stack = [parsed];
  while (stack.length) {
    const value = stack.shift();
    if (Array.isArray(value)) {
      if (value.length && value.every((row) => row && typeof row === "object" && !Array.isArray(row))) {
        if (value.some((row) => "name" in row || "organizations" in row)) return value;
      }
      stack.push(...value);
    } else if (value && typeof value === "object") {
      stack.push(...Object.values(value));
    }
  }
  throw new Error("Wrangler JSON did not contain query rows");
}

function executeReadOnly(target, query, runner) {
  const result = runner(
    npxExecutable(),
    [
      "--no-install",
      "wrangler",
      "d1",
      "execute",
      target,
      "--remote",
      "--json",
      "--command",
      query,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error("read-only verification query failed");
  return rowsFromWranglerJson(result.stdout);
}

export function parseVerificationArgs(argv) {
  return {
    target: parseFlagValue(argv, "--target", { required: true }),
    snapshotPath: parseFlagValue(argv, "--snapshot"),
    expectedCountsPath: parseFlagValue(argv, "--expected-counts"),
    execute: argv.includes("--execute"),
  };
}

export async function runVerification({
  target,
  snapshotPath,
  expectedCountsPath,
  execute,
  runner = spawnSync,
}) {
  assertRehearsalTarget(target);
  let snapshot;
  if (snapshotPath) {
    snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
  } else {
    if (!execute) {
      return {
        execute: false,
        commands: [TABLE_QUERY, AGGREGATE_QUERY],
      };
    }
    const tableRows = executeReadOnly(target, TABLE_QUERY, runner);
    const aggregateRows = executeReadOnly(target, AGGREGATE_QUERY, runner);
    const aggregate = aggregateRows[0] || {};
    const issueKeys = [
      "foreignKeyViolations",
      "orphanMemberships",
      "orphanBooths",
      "crossTenantProducts",
      "crossTenantInventory",
      "negativeTroopInventory",
      "negativeBoothInventory",
      "orphanScouts",
      "invalidScoutAssignments",
      "invalidScoutCredits",
    ];
    snapshot = {
      tables: tableRows.map((row) => row.name),
      counts: Object.fromEntries(
        Object.entries(aggregate).filter(([key]) => !issueKeys.includes(key)),
      ),
      issues: Object.fromEntries(
        issueKeys.map((key) => [key, Number(aggregate[key] || 0)]),
      ),
    };
  }
  const expectedCounts = expectedCountsPath
    ? JSON.parse(await readFile(expectedCountsPath, "utf8"))
    : null;
  return evaluateVerification(snapshot, expectedCounts);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  runVerification(parseVerificationArgs(args))
    .then((result) => {
      if (!result.execute && result.commands) {
        console.log("Plan only. Read-only aggregate queries will run against the rehearsal target.");
        return;
      }
      console.log(sanitizedVerificationOutput(result));
      if (!result.ok) process.exitCode = 2;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : "Verification failed");
      process.exitCode = 1;
    });
}
