export type AdminMfaDecision =
  | { required: false; configured: true; reason: "not_admin" }
  | { required: true; configured: true; reason: "configured" }
  | {
      required: true;
      configured: false;
      reason: "not_configured" | "status_unavailable";
    };

export type ClerkMfaUser = { twoFactorEnabled?: boolean };

export async function evaluateAdminMfa({
  clerkUserId,
  hasActiveAdminMembership,
  getClerkUser,
}: {
  clerkUserId: string;
  hasActiveAdminMembership: (clerkUserId: string) => Promise<boolean>;
  getClerkUser: (clerkUserId: string) => Promise<ClerkMfaUser>;
}): Promise<AdminMfaDecision> {
  let isAdmin: boolean;
  try {
    isAdmin = await hasActiveAdminMembership(clerkUserId);
  } catch {
    return { required: true, configured: false, reason: "status_unavailable" };
  }
  if (!isAdmin) {
    return { required: false, configured: true, reason: "not_admin" };
  }

  try {
    const user = await getClerkUser(clerkUserId);
    return user.twoFactorEnabled === true
      ? { required: true, configured: true, reason: "configured" }
      : { required: true, configured: false, reason: "not_configured" };
  } catch {
    return { required: true, configured: false, reason: "status_unavailable" };
  }
}
