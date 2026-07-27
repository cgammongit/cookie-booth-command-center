import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { assignments, booths, memberships, users } from "../db/schema";

export type OrganizationRole = "admin" | "lead" | "volunteer" | "auditor";
export type MembershipStatus = "pending" | "active" | "suspended";

export type OrganizationAccess = {
  clerkUserId: string;
  userId: number;
  membershipId: number;
  organizationId: number;
  role: OrganizationRole;
  status: MembershipStatus;
  canInviteUsers: boolean;
};

export async function getOrganizationAccess(
  organizationId: number,
): Promise<OrganizationAccess | null> {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) return null;

  const [access] = await getDb()
    .select({
      userId: users.id,
      membershipId: memberships.id,
      organizationId: memberships.organizationId,
      role: memberships.role,
      status: memberships.status,
      canInviteUsers: memberships.canInviteUsers,
    })
    .from(users)
    .innerJoin(
      memberships,
      and(
        eq(memberships.userId, users.id),
        eq(memberships.organizationId, organizationId),
        eq(memberships.status, "active"),
        eq(users.status, "active"),
      ),
    )
    .where(eq(users.clerkUserId, clerkUserId))
    .limit(1);

  return access ? { clerkUserId, ...access } : null;
}

export async function requireOrganizationAdmin(organizationId: number) {
  const access = await getOrganizationAccess(organizationId);
  if (!access) {
    return {
      error: Response.json({ error: "Access not assigned" }, { status: 403 }),
      access: null,
    };
  }
  if (access.role !== "admin") {
    return {
      error: Response.json(
        { error: "Administrator access is required" },
        { status: 403 },
      ),
      access: null,
    };
  }
  return { error: null, access };
}

export async function requireInvitationManager(organizationId: number) {
  const access = await getOrganizationAccess(organizationId);
  if (!access) {
    return {
      error: Response.json({ error: "Access not assigned" }, { status: 403 }),
      access: null,
    };
  }
  if (access.role !== "admin" && !(access.role === "lead" && access.canInviteUsers)) {
    return {
      error: Response.json(
        { error: "Invitation permission is required" },
        { status: 403 },
      ),
      access: null,
    };
  }
  return { error: null, access };
}

export type BoothAccess = OrganizationAccess & {
  boothId: number;
  archived: boolean;
  closed: boolean;
  assignmentRole: "lead" | "volunteer" | "auditor" | null;
  canOperate: boolean;
  canManage: boolean;
  canReconcile: boolean;
  canViewReports: boolean;
};

export async function getBoothAccess(boothId: number): Promise<BoothAccess | null> {
  const [booth] = await getDb()
    .select({
      id: booths.id,
      organizationId: booths.organizationId,
      status: booths.status,
      archivedAt: booths.archivedAt,
    })
    .from(booths)
    .where(eq(booths.id, boothId))
    .limit(1);
  if (!booth) return null;

  const access = await getOrganizationAccess(booth.organizationId);
  if (!access) return null;

  let assignmentRole: BoothAccess["assignmentRole"] = null;
  if (access.role === "lead" || access.role === "volunteer") {
    const [assignment] = await getDb()
      .select({ role: assignments.role })
      .from(assignments)
      .where(
        and(
          eq(assignments.boothId, boothId),
          eq(assignments.userId, access.userId),
        ),
      )
      .limit(1);
    if (!assignment) return null;
    assignmentRole = assignment.role;
  }

  return {
    ...access,
    boothId,
    archived: Boolean(booth.archivedAt),
    closed: booth.status === "closed",
    assignmentRole,
    canOperate:
      !booth.archivedAt &&
      booth.status !== "closed" &&
      (access.role === "admin" ||
        access.role === "lead" ||
        access.role === "volunteer"),
    canManage:
      !booth.archivedAt &&
      booth.status !== "closed" &&
      access.role === "admin",
    canReconcile:
      !booth.archivedAt &&
      booth.status !== "closed" &&
      (access.role === "admin" || access.role === "lead"),
    canViewReports: access.role === "admin" || access.role === "auditor",
  };
}

export async function requireBoothAccess(
  boothId: number,
  permission: "view" | "operate" | "manage" | "reconcile" | "reports" = "view",
) {
  const access = await getBoothAccess(boothId);
  const permitted =
    Boolean(access) &&
    (permission === "view" ||
      (permission === "operate" && access?.canOperate) ||
      (permission === "manage" && access?.canManage) ||
      (permission === "reconcile" && access?.canReconcile) ||
      (permission === "reports" && access?.canViewReports));

  if (!access || !permitted) {
    return {
      error: Response.json(
        { error: "You do not have access to this booth" },
        { status: 403 },
      ),
      access: null,
    };
  }
  return { error: null, access };
}
