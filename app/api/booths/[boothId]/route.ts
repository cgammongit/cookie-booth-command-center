import { env } from "cloudflare:workers";
import { requireBoothAccess } from "../../../../lib/access";

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

  const [booth, inventory] = await Promise.all([
    env.DB.prepare(`
    SELECT id, organization_id AS organizationId, name, address,
      location_name AS locationName, google_place_id AS googlePlaceId,
      latitude, longitude,
      starts_at AS startsAt, ends_at AS endsAt, status
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
  ]);

  return Response.json({
    booth,
    inventory: inventory.results,
    permissions: {
      canOperate: authorization.access.canOperate,
      canManage: authorization.access.canManage,
      canReconcile: authorization.access.canReconcile,
      canViewReports: authorization.access.canViewReports,
    },
  });
}
