import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireOrganizationAdmin } from "../../../../lib/access";

const bodySchema = z
  .object({
    organizationId: z.number().int().positive(),
    boothId: z.number().int().positive(),
    userId: z.number().int().positive(),
    assigned: z.boolean(),
  })
  .strict();

export async function PUT(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "Invalid booth assignment" }, { status: 400 });
  }

  const authorization = await requireOrganizationAdmin(parsed.data.organizationId);
  if (authorization.error) return authorization.error;

  const target = await env.DB.prepare(`
    SELECT m.id AS membershipId, m.role, b.name AS boothName
    FROM memberships m
    JOIN booths b ON b.organization_id = m.organization_id
    WHERE m.organization_id = ? AND m.user_id = ? AND m.status = 'active'
      AND b.id = ?
  `)
    .bind(
      parsed.data.organizationId,
      parsed.data.userId,
      parsed.data.boothId,
    )
    .first<{
      membershipId: number;
      role: "admin" | "lead" | "volunteer" | "auditor";
      boothName: string;
    }>();

  if (!target) {
    return Response.json(
      { error: "The active member or booth could not be found" },
      { status: 404 },
    );
  }
  if (target.role === "admin" || target.role === "auditor") {
    return Response.json(
      { error: "Administrators and auditors already have organization-wide access" },
      { status: 409 },
    );
  }

  const assignmentStatement = parsed.data.assigned
    ? env.DB.prepare(`
      INSERT INTO assignments (booth_id, user_id, role)
      VALUES (?, ?, ?)
      ON CONFLICT (booth_id, user_id) DO UPDATE SET role = excluded.role
    `)
      .bind(parsed.data.boothId, parsed.data.userId, target.role)
    : env.DB.prepare(`
      DELETE FROM assignments WHERE booth_id = ? AND user_id = ?
    `)
      .bind(parsed.data.boothId, parsed.data.userId);

  const now = new Date().toISOString();
  const auditStatement = env.DB.prepare(`
    INSERT INTO access_audit_log (
      organization_id, actor_user_id, target_membership_id, action,
      before_json, after_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    parsed.data.organizationId,
    authorization.access.userId,
    target.membershipId,
    parsed.data.assigned ? "booth_assigned" : "booth_unassigned",
    JSON.stringify({
      boothId: parsed.data.boothId,
      boothName: target.boothName,
      assigned: !parsed.data.assigned,
    }),
    JSON.stringify({
      boothId: parsed.data.boothId,
      boothName: target.boothName,
      assigned: parsed.data.assigned,
    }),
    now,
  );
  await env.DB.batch([assignmentStatement, auditStatement]);

  return Response.json({ assigned: parsed.data.assigned });
}
