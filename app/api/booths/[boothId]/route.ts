import { env } from "cloudflare:workers";
import { requireBoothAccess } from "../../../../lib/access";
import { getEffectiveBoothStatus } from "../../../../lib/booth-status";

export async function GET(
  _request: Request,
  context: { params: Promise<{ boothId: string }> },
) {
  const { boothId: rawBoothId } = await context.params;
  const boothId = Number(rawBoothId);
  if (!Number.isInteger(boothId) || boothId < 1) {
    return Response.json({ error: "Invalid booth" }, { status: 400 });
  }

  const authorization = await requireBoothAccess(boothId);
  if (authorization.error) return authorization.error;

  const [booth, inventory, paymentTotals] = await Promise.all([
    env.DB.prepare(`
    SELECT id, organization_id AS organizationId, name, address,
      location_name AS locationName, google_place_id AS googlePlaceId,
      latitude, longitude,
      starts_at AS startsAt, ends_at AS endsAt, status,
      scout_assignment_revision AS scoutAssignmentRevision
    FROM booths WHERE id = ?
  `).bind(boothId).first(),
    env.DB.prepare(`
      SELECT p.id AS productId, p.name, p.barcode, p.price,
        i.opening, i.sold, i.adjusted,
        (i.opening + i.adjusted - i.sold) AS remaining
      FROM inventory i
      JOIN products p ON p.id = i.product_id
      WHERE i.booth_id = ?
      ORDER BY p.name
    `).bind(boothId).all(),
    env.DB.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN total_amount ELSE 0 END), 0) AS cash,
        COALESCE(SUM(CASE WHEN payment_method = 'credit_card' THEN total_amount ELSE 0 END), 0) AS creditCard,
        COALESCE(SUM(CASE WHEN payment_method = 'venmo_paypal' THEN total_amount ELSE 0 END), 0) AS venmoPaypal,
        COALESCE(SUM(total_amount), 0) AS gross
      FROM sales
      WHERE booth_id = ?
        AND NOT EXISTS (SELECT 1 FROM sale_reversals r WHERE r.sale_id = sales.id)
    `).bind(boothId).first(),
  ]);

  return Response.json({
    booth: booth
      ? {
          ...booth,
          status: getEffectiveBoothStatus(booth as {
            status: string;
            startsAt: string;
            endsAt: string;
          }),
        }
      : booth,
    inventory: inventory.results,
    paymentTotals,
    permissions: {
      canOperate: authorization.access.canOperate,
      canManage: authorization.access.canManage,
      canReconcile: authorization.access.canReconcile,
      canReverseSales: authorization.access.canReverseSales,
      canViewReports: authorization.access.canViewReports,
    },
  });
}
