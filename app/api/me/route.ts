import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { memberships, organizations, users } from "../../../db/schema";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthenticated" }, { status: 401 });

  const db = getDb();
  const access = await db
    .select({
      userId: users.id,
      displayName: users.displayName,
      organizationId: organizations.id,
      organizationName: organizations.name,
      role: memberships.role,
    })
    .from(users)
    .innerJoin(
      memberships,
      and(eq(memberships.userId, users.id), eq(users.status, "active")),
    )
    .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
    .where(eq(users.clerkUserId, userId));

  if (!access.length) return Response.json({ error: "Access not assigned" }, { status: 403 });
  return Response.json({ memberships: access });
}
