import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  canAdministerOrganization,
  canManageInvitations,
  evaluateBoothPermission,
} from "../lib/authorization-policy.ts";
import {
  applySecurityHeaders,
  hasAllowedMutationOrigin,
  logServerEvent,
  redactLogContext,
  shouldCheckCsrf,
} from "../lib/security.ts";

const admin = {
  organizationId: 10,
  boothOrganizationId: 10,
  organizationRole: "admin",
  assigned: true,
  archived: false,
  closed: false,
};

test("organization policies reject cross-tenant administration and invitations", () => {
  assert.equal(canAdministerOrganization("admin", 10, 10), true);
  assert.equal(canAdministerOrganization("admin", 20, 10), false);
  assert.equal(canAdministerOrganization("lead", 10, 10), false);
  assert.equal(canManageInvitations("admin", false, 10, 10), true);
  assert.equal(canManageInvitations("lead", true, 10, 10), true);
  assert.equal(canManageInvitations("lead", false, 10, 10), false);
  assert.equal(canManageInvitations("lead", true, 20, 10), false);
  assert.equal(canManageInvitations("volunteer", true, 10, 10), false);
});

test("booth policies isolate organizations and enforce volunteer, lead, and admin roles", () => {
  for (const permission of ["view", "operate", "manage", "reconcile", "reports"]) {
    assert.equal(
      evaluateBoothPermission({ ...admin, boothOrganizationId: 20 }, permission),
      false,
      `cross-organization ${permission} must fail`,
    );
  }

  assert.equal(evaluateBoothPermission(admin, "manage"), true);
  assert.equal(evaluateBoothPermission(admin, "reconcile"), true);
  assert.equal(
    evaluateBoothPermission({ ...admin, organizationRole: "lead" }, "manage"),
    false,
  );
  assert.equal(
    evaluateBoothPermission({ ...admin, organizationRole: "lead" }, "reconcile"),
    true,
  );
  assert.equal(
    evaluateBoothPermission({ ...admin, organizationRole: "volunteer" }, "operate"),
    true,
  );
  assert.equal(
    evaluateBoothPermission({ ...admin, organizationRole: "volunteer" }, "reconcile"),
    false,
  );
  assert.equal(
    evaluateBoothPermission(
      { ...admin, organizationRole: "volunteer", assigned: false },
      "view",
    ),
    false,
  );
  assert.equal(
    evaluateBoothPermission({ ...admin, organizationRole: "auditor" }, "reports"),
    true,
  );
  assert.equal(
    evaluateBoothPermission({ ...admin, organizationRole: "auditor" }, "operate"),
    false,
  );
  assert.equal(evaluateBoothPermission({ ...admin, closed: true }, "operate"), false);
  assert.equal(evaluateBoothPermission({ ...admin, archived: true }, "manage"), false);
});

test("supplemental source assertions retain server authorization and tenant-scoped SQL", async () => {
  const files = {
    inventory: "../app/api/admin/booth-inventory/route.ts",
    troopInventory: "../app/api/admin/troop-inventory/route.ts",
    sales: "../app/api/booths/[boothId]/sales/route.ts",
    reconciliation: "../app/api/booths/[boothId]/reconciliation/route.ts",
    invitations: "../app/api/organization-invitations/route.ts",
    websocket: "../app/api/booths/[boothId]/live/route.ts",
    websocketHandler: "../worker/booth-live-handler.ts",
    websocketAccess: "../lib/booth-live-access.ts",
  };
  const source = Object.fromEntries(
    await Promise.all(
      Object.entries(files).map(async ([name, path]) => [
        name,
        await readFile(new URL(path, import.meta.url), "utf8"),
      ]),
    ),
  );

  assert.match(source.inventory, /requireOrganizationAdmin/);
  assert.match(source.inventory, /WHERE id = \? AND organization_id = \?/);
  assert.match(source.troopInventory, /requireOrganizationAdmin/);
  assert.match(source.troopInventory, /WHERE organization_id = \? AND product_id = \?/);
  assert.match(source.sales, /requireBoothAccess\(boothId, "operate"\)/);
  assert.match(source.sales, /authorization\.access\.organizationId/);
  assert.match(source.reconciliation, /requireBoothAccess\(boothId, "reconcile"\)/);
  assert.match(source.reconciliation, /authorization\.access\.organizationId/);
  assert.match(source.invitations, /requireInvitationManager/);
  assert.match(source.invitations, /organizationInvitations\.organizationId/);
  assert.match(source.websocket, /handleBoothLiveRequest/);
  assert.match(source.websocketHandler, /origin !== requestUrl\.origin/);
  assert.match(source.websocketHandler, /authorizeBoothLiveAccess/);
  assert.match(source.websocketHandler, /`\$\{access\.organizationId\}:\$\{boothId\}`/);
  assert.match(source.websocketAccess, /m\.status = 'active'/);
  assert.match(source.websocketAccess, /u\.status = 'active'/);
  assert.match(source.websocketAccess, /evaluateBoothPermission/);
});

test("unsafe API requests reject a supplied cross-origin Origin without changing webhook verification", () => {
  const sameOrigin = new Request("https://app.example/api/booths", {
    method: "POST",
    headers: { origin: "https://app.example" },
  });
  const crossOrigin = new Request("https://app.example/api/booths", {
    method: "POST",
    headers: { origin: "https://attacker.example" },
  });
  const webhook = new Request("https://app.example/api/webhooks/clerk", {
    method: "POST",
    headers: { origin: "https://api.clerk.com" },
  });

  assert.equal(shouldCheckCsrf(sameOrigin), true);
  assert.equal(hasAllowedMutationOrigin(sameOrigin), true);
  assert.equal(hasAllowedMutationOrigin(crossOrigin), false);
  assert.equal(shouldCheckCsrf(webhook), false);
});

test("security headers are staged and CSP remains report-only", () => {
  const headers = applySecurityHeaders(new Headers(), "request-123");
  assert.match(headers.get("content-security-policy-report-only") ?? "", /frame-ancestors 'none'/);
  assert.match(
    headers.get("content-security-policy-report-only") ?? "",
    /https:\/\/challenges\.cloudflare\.com/,
  );
  assert.match(
    headers.get("content-security-policy-report-only") ?? "",
    /https:\/\/\*\.protect\.clerk\.com/,
  );
  assert.equal(headers.has("content-security-policy"), false);
  assert.equal(headers.get("strict-transport-security"), "max-age=86400");
  assert.equal(headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.equal(headers.get("x-frame-options"), "DENY");
  assert.match(headers.get("permissions-policy") ?? "", /camera=\(\)/);
  assert.equal(headers.get("x-request-id"), "request-123");
});

test("structured logs redact secrets, Clerk data, PII, headers, and request bodies", () => {
  const redacted = redactLogContext({
    requestId: "request-123",
    route: "/api/booths/:id/sales",
    organizationId: 10,
    authorization: "Bearer secret",
    cookie: "__session=secret",
    clerkUserId: "user_secret",
    email: "person@example.com",
    requestBody: { payment: "cash" },
    errorCategory: "validation",
  });
  assert.equal(redacted.requestId, "request-123");
  assert.equal(redacted.organizationId, 10);
  assert.equal(redacted.authorization, "[redacted]");
  assert.equal(redacted.cookie, "[redacted]");
  assert.equal(redacted.clerkUserId, "[redacted]");
  assert.equal(redacted.email, "[redacted]");
  assert.equal(redacted.requestBody, "[redacted]");

  let emitted = "";
  const original = console.log;
  console.log = (value) => {
    emitted = String(value);
  };
  try {
    logServerEvent("info", "request.completed", {
      requestId: "request-123",
      route: "/api/booths/:id/sales",
      cookie: "must-not-appear",
    });
  } finally {
    console.log = original;
  }
  assert.doesNotMatch(emitted, /must-not-appear/);
  assert.deepEqual(JSON.parse(emitted).cookie, "[redacted]");
});
