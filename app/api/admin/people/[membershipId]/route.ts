import { env } from "cloudflare:workers";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../../../../../db";
import { memberships } from "../../../../../db/schema";
import { requireOrganizationAdmin } from "../../../../../lib/access";

const roleSchema = z.enum(["admin", "lead", "volunteer", "auditor"]);
const statusSchema = z.enum(["pending", "active", "suspended"]);
const bodySchema = z
  .object({
    organizationId: z.number().int().positive(),
    role: roleSchema,
    status: statusSchema,
    canInviteUsers: z.boolean(),
  })
  .strict();

type MembershipState = z.infer<typeof bodySchema> & {
  membershipId: number;
  userId: number;
};

export async function PATCH(
  request: Request,
  context: { params: Promise<{ membershipId: string }> },
) {
  const { membershipId: rawMembershipId } = await context.params;
  const membershipId = Number(rawMembershipId);
  if (!Number.isInteger(membershipId) || membershipId < 1) {
    return Response.json({ error: "Invalid membership" }, { status: 400 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: "Role, status, and invitation rights are required" },
      { status: 400 },
    );
  }

  const requested = parsed.data;
  const authorization = await requireOrganizationAdmin(requested.organizationId);
  if (authorization.error) return authorization.error;

  const [existing] = await getDb()
    .select({
      membershipId: memberships.id,
      organizationId: memberships.organizationId,
      userId: memberships.userId,
      role: memberships.role,
      status: memberships.status,
      canInviteUsers: memberships.canInviteUsers,
    })
    .from(memberships)
    .where(
      and(
        eq(memberships.id, membershipId),
        eq(memberships.organizationId, requested.organizationId),
      ),
    )
    .limit(1);

  if (!existing) {
    return Response.json({ error: "Membership not found" }, { status: 404 });
  }

  const normalized: MembershipState = {
    membershipId,
    userId: existing.userId,
    organizationId: requested.organizationId,
    role: requested.role,
    status: requested.status,
    canInviteUsers: requested.role === "lead" && requested.canInviteUsers,
  };

  const removesActiveAdmin =
    existing.role === "admin" &&
    existing.status === "active" &&
    (normalized.role !== "admin" || normalized.status !== "active");

  if (removesActiveAdmin) {
    const [otherAdmin] = await getDb()
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, requested.organizationId),
          eq(memberships.role, "admin"),
          eq(memberships.status, "active"),
          ne(memberships.id, membershipId),
        ),
      )
      .limit(1);
    if (!otherAdmin) {
      return Response.json(
        { error: "The organization must retain at least one active administrator" },
        { status: 409 },
      );
    }
  }

  const before = {
    role: existing.role,
    status: existing.status,
    canInviteUsers: existing.canInviteUsers,
  };
  const after = {
    role: normalized.role,
    status: normalized.status,
    canInviteUsers: normalized.canInviteUsers,
  };
  const changes = [
    before.role !== after.role ? "role_changed" : null,
    before.status !== after.status ? "status_changed" : null,
    before.canInviteUsers !== after.canInviteUsers
      ? "invitation_rights_changed"
      : null,
  ].filter(Boolean) as Array<
    "role_changed" | "status_changed" | "invitation_rights_changed"
  >;

  if (!changes.length) return Response.json({ membership: normalized });

  const now = new Date().toISOString();
  const statements = [
    env.DB.prepare(`
      UPDATE memberships
      SET role = ?, status = ?, can_invite_users = ?, updated_at = ?
      WHERE id = ? AND organization_id = ?
    `).bind(
      normalized.role,
      normalized.status,
      normalized.canInviteUsers ? 1 : 0,
      now,
      membershipId,
      requested.organizationId,
    ),
    ...changes.map((action) =>
      env.DB.prepare(`
        INSERT INTO access_audit_log (
          organization_id,
          actor_user_id,
          target_membership_id,
          action,
          before_json,
          after_json,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(
        requested.organizationId,
        authorization.access.userId,
        membershipId,
        action,
        JSON.stringify(before),
        JSON.stringify(after),
        now,
      ),
    ),
  ];
  await env.DB.batch(statements);

  return Response.json({ membership: normalized, updatedAt: now });
}
