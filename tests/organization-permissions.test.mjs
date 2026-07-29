import assert from "node:assert/strict";
import test from "node:test";
import {
  ORGANIZATION_PERMISSION_CATALOG,
  ORGANIZATION_PERMISSIONS,
  ORGANIZATION_ROLES,
  hasOrganizationPermission,
  isOrganizationPermission,
  isOrganizationRole,
} from "../lib/organization-permissions.ts";
import {
  canAdministerOrganization,
  canManageInvitations,
  evaluateBoothPermission,
} from "../lib/authorization-policy.ts";

const expectedGrants = {
  admin: [
    "booth.view",
    "booth.viewOrganizationWide",
    "booth.operate",
    "booth.manage",
    "booth.reconcile",
    "booth.create",
    "booth.archive",
    "assignment.manage",
    "inventory.manage",
    "troopInventory.manage",
    "product.manage",
    "people.manage",
    "invitation.manage",
    "invitation.manageAllRoles",
    "alert.manage",
    "report.view",
  ],
  lead: [
    "booth.view",
    "booth.operate",
    "booth.reconcile",
    "invitation.manage",
  ],
  volunteer: [
    "booth.view",
    "booth.operate",
  ],
  auditor: [
    "booth.view",
    "booth.viewOrganizationWide",
    "report.view",
  ],
};

test("catalog is complete, immutable, typed at runtime, and duplicate-free", () => {
  assert.deepEqual(ORGANIZATION_ROLES, ["admin", "lead", "volunteer", "auditor"]);
  assert.equal(Object.isFrozen(ORGANIZATION_PERMISSION_CATALOG), true);
  assert.equal(
    new Set(ORGANIZATION_PERMISSIONS).size,
    ORGANIZATION_PERMISSIONS.length,
  );

  for (const role of ORGANIZATION_ROLES) {
    const grants = ORGANIZATION_PERMISSION_CATALOG[role];
    assert.ok(grants.length > 0, `${role} must have an explicit grant`);
    assert.equal(Object.isFrozen(grants), true);
    assert.equal(new Set(grants).size, grants.length, `${role} grants must be unique`);
    assert.ok(grants.every(isOrganizationPermission));
  }
});

test("complete organization role-permission matrix preserves existing grants", () => {
  for (const role of ORGANIZATION_ROLES) {
    for (const permission of ORGANIZATION_PERMISSIONS) {
      assert.equal(
        hasOrganizationPermission(role, permission),
        expectedGrants[role].includes(permission),
        `${role} / ${permission}`,
      );
    }
  }
});

test("unknown roles, unknown permissions, and missing grants deny by default", () => {
  assert.equal(isOrganizationRole("owner"), false);
  assert.equal(isOrganizationPermission("organization.everything"), false);
  assert.equal(hasOrganizationPermission("owner", "booth.view"), false);
  assert.equal(hasOrganizationPermission("admin", "organization.everything"), false);
  assert.equal(hasOrganizationPermission(undefined, "booth.view"), false);
  assert.equal(hasOrganizationPermission("volunteer", "people.manage"), false);
  assert.equal(hasOrganizationPermission("auditor", "booth.operate"), false);
});

test("tenant, assignment, lifecycle, and invitation delegation remain contextual", () => {
  const booth = (organizationRole, overrides = {}) => ({
    organizationId: 10,
    boothOrganizationId: 10,
    organizationRole,
    assigned: true,
    archived: false,
    closed: false,
    ...overrides,
  });

  assert.equal(evaluateBoothPermission(booth("admin", { assigned: false }), "manage"), true);
  assert.equal(evaluateBoothPermission(booth("lead"), "reconcile"), true);
  assert.equal(evaluateBoothPermission(booth("lead", { assigned: false }), "view"), false);
  assert.equal(evaluateBoothPermission(booth("volunteer"), "operate"), true);
  assert.equal(evaluateBoothPermission(booth("volunteer"), "reconcile"), false);
  assert.equal(evaluateBoothPermission(booth("auditor", { assigned: false }), "view"), true);
  assert.equal(evaluateBoothPermission(booth("auditor"), "reports"), true);
  assert.equal(evaluateBoothPermission(booth("auditor"), "operate"), false);
  assert.equal(evaluateBoothPermission(booth("admin", { closed: true }), "operate"), false);
  assert.equal(evaluateBoothPermission(booth("lead", { archived: true }), "reconcile"), false);
  assert.equal(
    evaluateBoothPermission(booth("admin", { boothOrganizationId: 20 }), "view"),
    false,
  );

  assert.equal(canAdministerOrganization("admin", 10, 10), true);
  assert.equal(canAdministerOrganization("admin", 20, 10), false);
  assert.equal(canAdministerOrganization("lead", 10, 10), false);
  assert.equal(canManageInvitations("admin", false, 10, 10), true);
  assert.equal(canManageInvitations("lead", true, 10, 10), true);
  assert.equal(canManageInvitations("lead", false, 10, 10), false);
  assert.equal(canManageInvitations("lead", true, 20, 10), false);
  assert.equal(canManageInvitations("volunteer", true, 10, 10), false);
});
