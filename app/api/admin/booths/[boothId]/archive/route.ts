import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireOrganizationPermission } from "../../../../../../lib/access";
import { broadcastBoothEvent } from "../../../../../../lib/booth-live";

const archiveSchema = z.object({
  organizationId: z.number().int().positive(),
  reason: z.string().trim().min(5).max(500),
}).strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ boothId: string }> },
) {
  const { boothId: rawBoothId } = await context.params;
  const boothId = Number(rawBoothId);
  if (!Number.isInteger(boothId) || boothId < 1) {
    return Response.json({ error: "Invalid booth" }, { status: 400 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = archiveSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message || "Invalid archive request" },
      { status: 400 },
    );
  }

  const authorization = await requireOrganizationPermission(
    parsed.data.organizationId,
    "booth.archive",
  );
  if (authorization.error) return authorization.error;

  const booth = await env.DB.prepare(`
    SELECT id, name, status, archived_at AS archivedAt
    FROM booths
    WHERE id = ? AND organization_id = ?
  `).bind(boothId, parsed.data.organizationId).first<{
    id: number;
    name: string;
    status: string;
    archivedAt: string | null;
  }>();
  if (!booth) {
    return Response.json({ error: "Booth not found" }, { status: 404 });
  }
  if (booth.archivedAt) {
    return Response.json({ error: "Booth is already archived" }, { status: 409 });
  }
  if (booth.status === "closed") {
    return Response.json(
      { error: "Closed booths are already retained in the archive" },
      { status: 409 },
    );
  }

  const activity = await env.DB.prepare(`
    SELECT
      (SELECT COUNT(*) FROM transactions WHERE booth_id = ?) AS transactions,
      (SELECT COUNT(*) FROM reconciliations WHERE booth_id = ?) AS reconciliations,
      (
        SELECT COUNT(*) FROM inventory
        WHERE booth_id = ? AND (sold <> 0 OR adjusted <> 0)
      ) AS inventoryChanges
  `).bind(boothId, boothId, boothId).first<{
    transactions: number;
    reconciliations: number;
    inventoryChanges: number;
  }>();
  const activityCounts = {
    transactions: Number(activity?.transactions || 0),
    reconciliations: Number(activity?.reconciliations || 0),
    inventoryChanges: Number(activity?.inventoryChanges || 0),
  };
  const hasActivity = Object.values(activityCounts).some((count) => count > 0);
  const now = new Date().toISOString();
  const details = JSON.stringify({
    reason: parsed.data.reason,
    previousStatus: booth.status,
    activity: activityCounts,
    alertCreated: hasActivity,
  });

  const statements = [
    env.DB.prepare(`
      UPDATE booths
      SET archived_at = ?, archived_by_user_id = ?, archive_reason = ?,
          archive_kind = 'manual'
      WHERE id = ? AND organization_id = ? AND archived_at IS NULL
    `).bind(
      now,
      authorization.access.userId,
      parsed.data.reason,
      boothId,
      parsed.data.organizationId,
    ),
    env.DB.prepare(`
      INSERT INTO booth_lifecycle_audit (
        organization_id, booth_id, actor_user_id, action, details_json, created_at
      ) VALUES (?, ?, ?, 'manually_archived', ?, ?)
    `).bind(
      parsed.data.organizationId,
      boothId,
      authorization.access.userId,
      details,
      now,
    ),
  ];

  if (hasActivity) {
    statements.push(
      env.DB.prepare(`
        INSERT INTO admin_alerts (
          organization_id, booth_id, type, status, muted, created_at, updated_at
        ) VALUES (?, ?, 'manual_archive_with_activity', 'open', 0, ?, ?)
      `).bind(parsed.data.organizationId, boothId, now, now),
    );
  }

  await env.DB.batch(statements);
  await broadcastBoothEvent(
    parsed.data.organizationId,
    boothId,
    ["lifecycle"],
  ).catch(() => undefined);
  return Response.json({
    archived: true,
    alertCreated: hasActivity,
    activity: activityCounts,
  });
}
