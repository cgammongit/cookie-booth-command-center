import { asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../../../../db";
import {
  accessAuditLog,
  memberships,
  users,
} from "../../../../db/schema";
import { requireOrganizationAdmin } from "../../../../lib/access";

const querySchema = z.object({
  organizationId: z.coerce.number().int().positive(),
});

export async function GET(request: Request) {
  const parsed = querySchema.safeParse({
    organizationId: new URL(request.url).searchParams.get("organizationId"),
  });
  if (!parsed.success) {
    return Response.json({ error: "A valid organization is required" }, { status: 400 });
  }

  const { organizationId } = parsed.data;
  const authorization = await requireOrganizationAdmin(organizationId);
  if (authorization.error) return authorization.error;

  const db = getDb();
  const people = await db
    .select({
      membershipId: memberships.id,
      userId: users.id,
      displayName: users.displayName,
      email: users.email,
      identityStatus: users.status,
      role: memberships.role,
      status: memberships.status,
      canInviteUsers: memberships.canInviteUsers,
      createdAt: memberships.createdAt,
      updatedAt: memberships.updatedAt,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.organizationId, organizationId))
    .orderBy(asc(users.displayName), asc(users.email));

  const audit = await db
    .select({
      id: accessAuditLog.id,
      actorUserId: accessAuditLog.actorUserId,
      targetMembershipId: accessAuditLog.targetMembershipId,
      action: accessAuditLog.action,
      beforeJson: accessAuditLog.beforeJson,
      afterJson: accessAuditLog.afterJson,
      createdAt: accessAuditLog.createdAt,
    })
    .from(accessAuditLog)
    .where(eq(accessAuditLog.organizationId, organizationId))
    .orderBy(desc(accessAuditLog.createdAt))
    .limit(25);

  return Response.json({
    people,
    audit,
    currentUserId: authorization.access.userId,
  });
}
