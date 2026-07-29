export const ORGANIZATION_ROLES = [
  "admin",
  "lead",
  "volunteer",
  "auditor",
] as const;

export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

export const ORGANIZATION_PERMISSIONS = [
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
] as const;

export type OrganizationPermission = (typeof ORGANIZATION_PERMISSIONS)[number];

const permissionCatalog = Object.freeze({
  admin: Object.freeze([
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
  ]),
  lead: Object.freeze([
    "booth.view",
    "booth.operate",
    "booth.reconcile",
    "invitation.manage",
  ]),
  volunteer: Object.freeze([
    "booth.view",
    "booth.operate",
  ]),
  auditor: Object.freeze([
    "booth.view",
    "booth.viewOrganizationWide",
    "report.view",
  ]),
} as const satisfies Readonly<
  Record<OrganizationRole, readonly OrganizationPermission[]>
>);

export const ORGANIZATION_PERMISSION_CATALOG = permissionCatalog;

const knownRoles = new Set<string>(ORGANIZATION_ROLES);
const knownPermissions = new Set<string>(ORGANIZATION_PERMISSIONS);

export function isOrganizationRole(role: unknown): role is OrganizationRole {
  return typeof role === "string" && knownRoles.has(role);
}

export function isOrganizationPermission(
  permission: unknown,
): permission is OrganizationPermission {
  return typeof permission === "string" && knownPermissions.has(permission);
}

export function hasOrganizationPermission(
  role: unknown,
  permission: unknown,
): boolean {
  if (!isOrganizationRole(role) || !isOrganizationPermission(permission)) {
    return false;
  }
  return ORGANIZATION_PERMISSION_CATALOG[role].includes(
    permission as never,
  );
}
