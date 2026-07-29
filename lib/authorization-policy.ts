import {
  hasOrganizationPermission,
  type OrganizationRole,
} from "./organization-permissions";

export type { OrganizationRole } from "./organization-permissions";
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
  return (
    resourceOrganizationId === actorOrganizationId &&
    hasOrganizationPermission(role, "people.manage")
  );
}

export function canManageInvitations(
  role: OrganizationRole,
  canInviteUsers: boolean,
  resourceOrganizationId: number,
  actorOrganizationId: number,
) {
  return (
    resourceOrganizationId === actorOrganizationId &&
    hasOrganizationPermission(role, "invitation.manage") &&
    (hasOrganizationPermission(role, "invitation.manageAllRoles") ||
      canInviteUsers)
  );
}

export function evaluateBoothPermission(
  input: BoothPolicyInput,
  permission: BoothPermission,
) {
  if (input.organizationId !== input.boothOrganizationId) return false;
  if (!hasOrganizationPermission(input.organizationRole, "booth.view")) {
    return false;
  }
  if (
    !hasOrganizationPermission(
      input.organizationRole,
      "booth.viewOrganizationWide",
    ) &&
    !input.assigned
  ) {
    return false;
  }
  if (permission === "view") return true;
  if (permission === "reports") {
    return hasOrganizationPermission(input.organizationRole, "report.view");
  }
  if (input.archived || input.closed) return false;
  if (permission === "manage") {
    return hasOrganizationPermission(input.organizationRole, "booth.manage");
  }
  if (permission === "reconcile") {
    return hasOrganizationPermission(input.organizationRole, "booth.reconcile");
  }
  return (
    permission === "operate" &&
    hasOrganizationPermission(input.organizationRole, "booth.operate")
  );
}
