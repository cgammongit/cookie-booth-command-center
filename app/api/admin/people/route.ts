import { asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../../../../db";
import {
  accessAuditLog,
  assignments,
  booths,
  memberships,
  users,
} from "../../../../db/schema";
import { requireOrganizationPermission } from "../../../../lib/access";
import { listOrganizationInvitations } from "../../../../lib/invitations";

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
  const authorization = await requireOrganizationPermission(
    organizationId,
    "people.manage",
  );
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

  const organizationBooths = await db
    .select({
      id: booths.id,
      name: booths.name,
      startsAt: booths.startsAt,
      status: booths.status,
    })
    .from(booths)
    .where(eq(booths.organizationId, organizationId))
    .orderBy(asc(booths.startsAt), asc(booths.name));

  const boothAssignments = await db
    .select({
      boothId: assignments.boothId,
      userId: assignments.userId,
      role: assignments.role,
    })
    .from(assignments)
    .innerJoin(booths, eq(booths.id, assignments.boothId))
    .where(eq(booths.organizationId, organizationId));

  return Response.json({
    people,
    audit,
    booths: organizationBooths,
    assignments: boothAssignments,
    invitations: await listOrganizationInvitations(organizationId),
    currentUserId: authorization.access.userId,
  });
}
