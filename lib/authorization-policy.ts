export type OrganizationRole = "admin" | "lead" | "volunteer" | "auditor";
export type BoothPermission = "view" | "operate" | "manage" | "reconcile" | "reports";

export type BoothPolicyInput = {
  organizationId: number;
  boothOrganizationId: number;
  organizationRole: OrganizationRole;
  assigned: boolean;
  archived: boolean;
  closed: boolean;
};

export function canAdministerOrganization(
  role: OrganizationRole,
  resourceOrganizationId: number,
  actorOrganizationId: number,
) {
  return role === "admin" && resourceOrganizationId === actorOrganizationId;
}

export function canManageInvitations(
  role: OrganizationRole,
  canInviteUsers: boolean,
  resourceOrganizationId: number,
  actorOrganizationId: number,
) {
  return (
    resourceOrganizationId === actorOrganizationId &&
    (role === "admin" || (role === "lead" && canInviteUsers))
  );
}

export function evaluateBoothPermission(
  input: BoothPolicyInput,
  permission: BoothPermission,
) {
  if (input.organizationId !== input.boothOrganizationId) return false;
  if (
    (input.organizationRole === "lead" || input.organizationRole === "volunteer") &&
    !input.assigned
  ) {
    return false;
  }
  if (permission === "view") return true;
  if (permission === "reports") {
    return input.organizationRole === "admin" || input.organizationRole === "auditor";
  }
  if (input.archived || input.closed) return false;
  if (permission === "manage") return input.organizationRole === "admin";
  if (permission === "reconcile") {
    return input.organizationRole === "admin" || input.organizationRole === "lead";
  }
  return (
    permission === "operate" &&
    (input.organizationRole === "admin" ||
      input.organizationRole === "lead" ||
      input.organizationRole === "volunteer")
  );
}
