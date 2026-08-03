import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { users } from "../db/schema";
import { isSuperAdminClerkUser } from "./super-admin";

const ADMINISTRATOR_OVERRIDE_EMAIL = "cgammon2014@gmail.com";

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export async function canManageProtectedAdministrators(clerkUserId: string) {
  if (!isSuperAdminClerkUser(clerkUserId)) return false;

  const [identity] = await getDb()
    .select({ email: users.email })
    .from(users)
    .where(
      and(
        eq(users.clerkUserId, clerkUserId),
        eq(users.status, "active"),
      ),
    )
    .limit(1);

  return Boolean(
    identity &&
      normalizeEmail(identity.email) === ADMINISTRATOR_OVERRIDE_EMAIL,
  );
}
