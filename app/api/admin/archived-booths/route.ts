import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireOrganizationPermission } from "../../../../lib/access";

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

  const authorization = await requireOrganizationPermission(
    parsed.data.organizationId,
    "booth.manage",
  );
  if (authorization.error) return authorization.error;

  const [booths, alerts] = await Promise.all([
    env.DB.prepare(`
      SELECT
        b.id, b.name, b.address, b.location_name AS locationName,
        b.starts_at AS startsAt, b.ends_at AS endsAt, b.status,
        b.archived_at AS archivedAt, b.archive_reason AS archiveReason,
        b.archive_kind AS archiveKind,
        actor.display_name AS archivedBy,
        r.closed_at AS closedAt,
        r.cash_total AS cashTurnedIn,
        r.expected_cash_total AS expectedCash,
        r.cash_discrepancy AS cashDiscrepancy,
        r.credit_card_total AS creditCardTotal,
        r.venmo_paypal_total AS venmoPaypalTotal,
        r.actual_box_count AS returnedBoxCount,
        r.inventory_discrepancy_count AS inventoryDiscrepancy,
        r.notes AS reconciliationNotes,
        COALESCE((
          SELECT SUM(CASE WHEN t.type = 'sale' THEN t.quantity ELSE 0 END)
          FROM transactions t WHERE t.booth_id = b.id
            AND (t.sale_id IS NULL OR NOT EXISTS (SELECT 1 FROM sale_reversals sr WHERE sr.sale_id = t.sale_id))
        ), 0) AS boxes,
        COALESCE((
          SELECT SUM(CASE WHEN t.type = 'sale' THEN t.amount ELSE 0 END)
          FROM transactions t WHERE t.booth_id = b.id
            AND (t.sale_id IS NULL OR NOT EXISTS (SELECT 1 FROM sale_reversals sr WHERE sr.sale_id = t.sale_id))
        ), 0) AS revenue,
        (SELECT COUNT(*) FROM transactions t WHERE t.booth_id = b.id) AS transactionCount,
        (SELECT COUNT(*) FROM reconciliations r WHERE r.booth_id = b.id) AS reconciliationCount
      FROM booths b
      LEFT JOIN users actor ON actor.id = b.archived_by_user_id
      LEFT JOIN reconciliations r ON r.booth_id = b.id
      WHERE b.organization_id = ?
        AND (b.status = 'closed' OR b.archived_at IS NOT NULL)
      ORDER BY COALESCE(b.archived_at, b.ends_at) DESC, b.name
    `).bind(parsed.data.organizationId).all(),
    env.DB.prepare(`
      SELECT
        a.id, a.booth_id AS boothId, b.name AS boothName, a.type, a.status,
        a.muted, a.acknowledged_at AS acknowledgedAt, a.muted_at AS mutedAt,
        a.resolution_note AS resolutionNote, a.created_at AS createdAt,
        a.updated_at AS updatedAt
      FROM admin_alerts a
      JOIN booths b ON b.id = a.booth_id
      WHERE a.organization_id = ?
      ORDER BY
        CASE a.status WHEN 'review' THEN 0 WHEN 'open' THEN 1
          WHEN 'acknowledged' THEN 2 ELSE 3 END,
        a.created_at DESC
    `).bind(parsed.data.organizationId).all(),
  ]);

  return Response.json({ booths: booths.results, alerts: alerts.results });
}
