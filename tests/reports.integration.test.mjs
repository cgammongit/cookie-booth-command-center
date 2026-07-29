import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(
  new URL("../app/api/reports/booth-sales/route.ts", import.meta.url),
  "utf8",
);
const reports = await readFile(
  new URL("../app/reports.tsx", import.meta.url),
  "utf8",
);
const dashboard = await readFile(
  new URL("../app/dashboard.tsx", import.meta.url),
  "utf8",
);

test("reports are tenant-scoped and limited to administrators and auditors", () => {
  assert.match(route, /getOrganizationAccess\(parsed\.data\.organizationId\)/);
  assert.match(route, /hasOrganizationPermission\(access\.role, "report\.view"\)/);
  assert.match(route, /selected booths do not belong to this organization/);
  assert.match(route, /b\.organization_id = \?/);
});

test("reporting uses authoritative sales, payment, item, and reconciliation data", () => {
  assert.match(route, /FROM booths b[\s\S]*LEFT JOIN sales s/);
  assert.match(route, /JOIN sales s ON s\.id = t\.sale_id/);
  assert.match(route, /s\.payment_method = 'cash'/);
  assert.match(route, /s\.payment_method = 'credit_card'/);
  assert.match(route, /s\.payment_method = 'venmo_paypal'/);
  assert.match(route, /FROM reconciliations r/);
});

test("reports support multi-booth selection, dates, CSV, print, and three views", () => {
  assert.match(reports, /boothIds: boothIds\.join\(","\)/);
  assert.match(reports, /type="date"/);
  assert.match(reports, /Export CSV/);
  assert.match(reports, /window\.print\(\)/);
  assert.match(reports, /Gross & payments/);
  assert.match(reports, /Itemized cookies/);
  assert.match(reports, /Reconciliation/);
  assert.match(dashboard, /setView\("reports"\)/);
});
