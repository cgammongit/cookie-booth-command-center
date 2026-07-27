import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { memberships, users } from "../db/schema";

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
