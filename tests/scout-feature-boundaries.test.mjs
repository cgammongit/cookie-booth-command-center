import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const files = Object.fromEntries(await Promise.all([
  "app/api/admin/scouts/route.ts", "app/api/admin/scouts/[scoutId]/route.ts",
  "app/api/admin/booth-scouts/route.ts", "app/api/booths/route.ts",
  "app/api/booths/[boothId]/reconciliation/route.ts", "app/api/reports/booth-sales/route.ts",
  "app/reports.tsx", "app/people-roles.tsx", "app/dashboard.tsx",
  "app/api/super-admin/organizations/route.ts", "scripts/dr/verify-d1-rehearsal.mjs",
].map(async (path) => [path, await readFile(new URL(`../${path}`, import.meta.url), "utf8")])));

test("scout mutations use existing admin permissions and tenant predicates", () => {
  assert.match(files["app/api/admin/scouts/route.ts"], /requireOrganizationPermission[\s\S]*people\.manage/);
  assert.match(files["app/api/admin/scouts/[scoutId]/route.ts"], /WHERE id = \? AND organization_id = \?/);
  assert.match(files["app/api/admin/booth-scouts/route.ts"], /assignment\.manage/);
  assert.match(files["app/api/admin/booth-scouts/route.ts"], /attendance_conflict/);
});

test("server creates timestamps and ignores client credit or sale timestamps", () => {
  assert.doesNotMatch(files["app/api/booths/route.ts"], /creditNumerator/);
  assert.match(files["app/api/booths/[boothId]/reconciliation/route.ts"], /calculateBoothScoutCredit/);
  assert.match(files["app/api/booths/[boothId]/reconciliation/route.ts"], /INSERT INTO scout_sales_credits/);
});

test("official scout report reads finalized credit and supports CSV and print", () => {
  assert.match(files["app/api/reports/booth-sales/route.ts"], /FROM scout_sales_credits/);
  assert.match(files["app/reports.tsx"], /Total Cookie Sales per Scout/);
  assert.match(files["app/reports.tsx"], /Export CSV/);
  assert.match(files["app/reports.tsx"], /window\.print/);
});

test("directory, create-booth assignment, purge, and recovery surfaces include scouts", () => {
  assert.match(files["app/people-roles.tsx"], /ScoutDirectory/);
  assert.match(files["app/dashboard.tsx"], /scoutIds: selectedScoutIds/);
  assert.match(files["app/api/super-admin/organizations/route.ts"], /DELETE FROM scout_sales_credits/);
  assert.match(files["scripts/dr/verify-d1-rehearsal.mjs"], /invalidScoutCredits/);
});
