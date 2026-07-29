import { auth } from "@clerk/nextjs/server";
import { env } from "cloudflare:workers";

function configuredSuperAdminIds() {
  return new Set(
    String(env.SUPER_ADMIN_CLERK_USER_IDS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

export function isSuperAdminClerkUser(clerkUserId: string | null | undefined) {
  return Boolean(clerkUserId && configuredSuperAdminIds().has(clerkUserId));
}

export async function requireSuperAdmin() {
  const { userId } = await auth();
  if (!userId || !isSuperAdminClerkUser(userId)) {
    return {
      error: Response.json({ error: "Super Administrator access is required" }, { status: 403 }),
      clerkUserId: null,
    };
  }
  return { error: null, clerkUserId: userId };
}
