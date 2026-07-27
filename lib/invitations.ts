import { asc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { organizationInvitations, users } from "../db/schema";

export async function listOrganizationInvitations(organizationId: number) {
  return getDb()
    .select({
      id: organizationInvitations.id,
      membershipId: organizationInvitations.membershipId,
      email: organizationInvitations.email,
      role: organizationInvitations.role,
      canInviteUsers: organizationInvitations.canInviteUsers,
      status: organizationInvitations.status,
      invitedByUserId: organizationInvitations.invitedByUserId,
      invitedByName: users.displayName,
      createdAt: organizationInvitations.createdAt,
      updatedAt: organizationInvitations.updatedAt,
      acceptedAt: organizationInvitations.acceptedAt,
      cancelledAt: organizationInvitations.cancelledAt,
    })
    .from(organizationInvitations)
    .innerJoin(users, eq(users.id, organizationInvitations.invitedByUserId))
    .where(eq(organizationInvitations.organizationId, organizationId))
    .orderBy(asc(organizationInvitations.status), asc(organizationInvitations.email));
}

export function invitationRedirectUrl(request: Request) {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  return configured || new URL(request.url).origin;
}

export function clerkErrorMessage(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "errors" in error &&
    Array.isArray(error.errors)
  ) {
    const first = error.errors[0] as { longMessage?: string; message?: string } | undefined;
    return first?.longMessage || first?.message || "Clerk could not send the invitation";
  }
  return "Clerk could not send the invitation";
}
