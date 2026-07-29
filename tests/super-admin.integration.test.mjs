import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Super Admin authorization is a server-side Clerk user allowlist", async () => {
  const access = await read("lib/super-admin.ts");
  const page = await read("app/page.tsx");
  const route = await read("app/api/super-admin/organizations/route.ts");

  assert.match(access, /SUPER_ADMIN_CLERK_USER_IDS/);
  assert.match(access, /await auth\(\)/);
  assert.match(route, /requireSuperAdmin\(\)/g);
  assert.match(page, /isSuperAdminClerkUser\(userId\)/);
});

test("organization purge preserves identity, invitations, and products", async () => {
  const route = await read("app/api/super-admin/organizations/route.ts");
  const batch = route.slice(route.indexOf("await env.DB.batch"));

  for (const table of [
    "reconciliation_items", "reconciliations", "transactions", "sales",
    "inventory", "assignments", "admin_alerts", "booth_lifecycle_audit",
    "inventory_configuration_audit", "inventory_ledger",
    "troop_inventory_balances", "access_audit_log", "product_catalog_audit",
    "booths",
  ]) {
    assert.match(batch, new RegExp(`DELETE FROM ${table}`));
  }
  for (const protectedTable of [
    "organizations", "users", "memberships", "organization_invitations",
    "products", "super_admin_audit_log",
  ]) {
    assert.doesNotMatch(batch, new RegExp(`DELETE FROM ${protectedTable}(?:\\s|$)`));
  }
  assert.match(batch, /INSERT INTO super_admin_audit_log/);
});

test("purge requires organization-name and acknowledgment confirmation", async () => {
  const route = await read("app/api/super-admin/organizations/route.ts");
  const ui = await read("app/super-admin-dashboard.tsx");

  assert.match(route, /acknowledged: z\.literal\(true\)/);
  assert.match(route, /confirmationName !== organization\.name/);
  assert.match(ui, /window\.confirm/);
  assert.match(ui, /Members, invitations, roles, and products will be preserved/);
});
