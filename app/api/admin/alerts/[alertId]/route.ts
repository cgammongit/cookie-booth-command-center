import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireOrganizationPermission } from "../../../../../lib/access";

const updateSchema = z.object({
  organizationId: z.number().int().positive(),
  action: z.enum(["acknowledge", "mute", "unmute", "review", "resolve"]),
  note: z.string().trim().max(500).optional(),
}).strict().refine(
  (value) => value.action !== "resolve" || Boolean(value.note && value.note.length >= 5),
  { message: "A resolution note of at least 5 characters is required" },
);

export async function PATCH(
  request: Request,
  context: { params: Promise<{ alertId: string }> },
) {
  const { alertId: rawAlertId } = await context.params;
  const alertId = Number(rawAlertId);
  if (!Number.isInteger(alertId) || alertId < 1) {
    return Response.json({ error: "Invalid alert" }, { status: 400 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = updateSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message || "Invalid alert update" },
      { status: 400 },
    );
  }

  const authorization = await requireOrganizationPermission(
    parsed.data.organizationId,
    "alert.manage",
  );
  if (authorization.error) return authorization.error;

  const alert = await env.DB.prepare(`
    SELECT id, booth_id AS boothId, status, muted
    FROM admin_alerts
    WHERE id = ? AND organization_id = ?
  `).bind(alertId, parsed.data.organizationId).first<{
    id: number;
    boothId: number;
    status: string;
    muted: number;
  }>();
  if (!alert) {
    return Response.json({ error: "Alert not found" }, { status: 404 });
  }

  const now = new Date().toISOString();
  const action = parsed.data.action;
  const status =
    action === "acknowledge" ? "acknowledged" :
    action === "review" ? "review" :
    action === "resolve" ? "resolved" :
    alert.status;
  const muted = action === "mute" ? 1 : action === "unmute" ? 0 : alert.muted;
  const auditAction =
    action === "acknowledge" ? "alert_acknowledged" :
    action === "review" ? "alert_flagged" :
    action === "resolve" ? "alert_resolved" :
    action === "mute" ? "alert_muted" : "alert_unmuted";

  await env.DB.batch([
    env.DB.prepare(`
      UPDATE admin_alerts
      SET status = ?, muted = ?,
        acknowledged_by_user_id = CASE WHEN ? = 'acknowledge' THEN ? ELSE acknowledged_by_user_id END,
        acknowledged_at = CASE WHEN ? = 'acknowledge' THEN ? ELSE acknowledged_at END,
        muted_by_user_id = CASE WHEN ? = 'mute' THEN ? WHEN ? = 'unmute' THEN NULL ELSE muted_by_user_id END,
        muted_at = CASE WHEN ? = 'mute' THEN ? WHEN ? = 'unmute' THEN NULL ELSE muted_at END,
        resolution_note = CASE WHEN ? = 'resolve' THEN ? ELSE resolution_note END,
        updated_at = ?
      WHERE id = ? AND organization_id = ?
    `).bind(
      status,
      muted,
      action,
      authorization.access.userId,
      action,
      now,
      action,
      authorization.access.userId,
      action,
      action,
      now,
      action,
      action,
      parsed.data.note || null,
      now,
      alertId,
      parsed.data.organizationId,
    ),
    env.DB.prepare(`
      INSERT INTO booth_lifecycle_audit (
        organization_id, booth_id, actor_user_id, action, details_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      parsed.data.organizationId,
      alert.boothId,
      authorization.access.userId,
      auditAction,
      JSON.stringify({ alertId, note: parsed.data.note || null }),
      now,
    ),
  ]);

  return Response.json({ updated: true });
}
