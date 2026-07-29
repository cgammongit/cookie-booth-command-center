import { clerkClient } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { memberships, users } from "../db/schema";
import { evaluateAdminMfa, type AdminMfaDecision } from "./admin-mfa-policy";

export type { AdminMfaDecision } from "./admin-mfa-policy";

export async function getAdminMfaDecision(
  clerkUserId: string,
): Promise<AdminMfaDecision> {
  return evaluateAdminMfa({
    clerkUserId,
    hasActiveAdminMembership: async (authoritativeUserId) => {
      const [adminMembership] = await getDb()
        .select({ membershipId: memberships.id })
        .from(users)
        .innerJoin(
          memberships,
          and(
            eq(memberships.userId, users.id),
            eq(memberships.role, "admin"),
            eq(memberships.status, "active"),
            eq(users.status, "active"),
          ),
        )
        .where(eq(users.clerkUserId, authoritativeUserId))
        .limit(1);
      return Boolean(adminMembership);
    },
    getClerkUser: async (authoritativeUserId) =>
      (await clerkClient()).users.getUser(authoritativeUserId),
  });
}

export function adminMfaApiResponse() {
  return Response.json(
    {
      error: "mfa_required",
      message: "Administrator MFA enrollment is required.",
    },
    { status: 403 },
  );
}
