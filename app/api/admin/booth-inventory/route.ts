import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireOrganizationAdmin } from "../../../../lib/access";

const querySchema = z.object({
  organizationId: z.coerce.number().int().positive(),
  boothId: z.coerce.number().int().positive(),
});

const saveSchema = z.object({
  organizationId: z.number().int().positive(),
  boothId: z.number().int().positive(),
  allocations: z.array(z.object({
    productId: z.number().int().positive(),
    opening: z.number().int().min(0).max(10000),
  }).strict()).max(250),
}).strict();

async function findBooth(organizationId: number, boothId: number) {
  return env.DB.prepare(`
    SELECT id, status, archived_at AS archivedAt
    FROM booths WHERE id = ? AND organization_id = ?
  `).bind(boothId, organizationId).first<{
    id: number;
    status: string;
    archivedAt: string | null;
  }>();
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    organizationId: url.searchParams.get("organizationId"),
    boothId: url.searchParams.get("boothId"),
  });
  if (!parsed.success) {
    return Response.json({ error: "Valid organization and booth are required" }, { status: 400 });
  }
  const authorization = await requireOrganizationAdmin(parsed.data.organizationId);
  if (authorization.error) return authorization.error;
  const booth = await findBooth(parsed.data.organizationId, parsed.data.boothId);
  if (!booth) return Response.json({ error: "Booth not found" }, { status: 404 });

  const result = await env.DB.prepare(`
    SELECT p.id, p.name, p.barcode, p.price, p.active,
      i.opening, i.sold, i.adjusted
    FROM products p
    LEFT JOIN inventory i ON i.product_id = p.id AND i.booth_id = ?
    WHERE p.organization_id = ?
    ORDER BY p.active DESC, p.name
  `).bind(parsed.data.boothId, parsed.data.organizationId).all();
  return Response.json({
    inventory: result.results,
    editable: !booth.archivedAt && booth.status !== "closed",
  });
}

export async function PUT(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = saveSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message || "Invalid inventory configuration" },
      { status: 400 },
    );
  }
  const authorization = await requireOrganizationAdmin(parsed.data.organizationId);
  if (authorization.error) return authorization.error;
  const booth = await findBooth(parsed.data.organizationId, parsed.data.boothId);
  if (!booth) return Response.json({ error: "Booth not found" }, { status: 404 });
  if (booth.archivedAt || booth.status === "closed") {
    return Response.json(
      { error: "Archived and closed booth inventory cannot be reconfigured" },
      { status: 409 },
    );
  }

  const productIds = [...new Set(parsed.data.allocations.map((item) => item.productId))];
  if (productIds.length !== parsed.data.allocations.length) {
    return Response.json({ error: "Each product may be allocated only once" }, { status: 400 });
  }
  if (productIds.length) {
    const placeholders = productIds.map(() => "?").join(",");
    const valid = await env.DB.prepare(`
      SELECT COUNT(*) AS count FROM products
      WHERE organization_id = ? AND active = 1 AND id IN (${placeholders})
    `).bind(parsed.data.organizationId, ...productIds).first<{ count: number }>();
    if (Number(valid?.count || 0) !== productIds.length) {
      return Response.json(
        { error: "One or more selected products are inactive or outside this organization" },
        { status: 400 },
      );
    }
  }

  const before = await env.DB.prepare(`
    SELECT product_id AS productId, opening, sold, adjusted
    FROM inventory WHERE booth_id = ? ORDER BY product_id
  `).bind(parsed.data.boothId).all();
  const existing = before.results as Array<{
    productId: number;
    opening: number;
    sold: number;
    adjusted: number;
  }>;
  const requested = new Map(parsed.data.allocations.map((item) => [item.productId, item.opening]));
  const blockedRemoval = existing.find(
    (item) =>
      !requested.has(item.productId) &&
      (Number(item.sold) !== 0 || Number(item.adjusted) !== 0),
  );
  if (blockedRemoval) {
    return Response.json(
      { error: "Products with recorded booth activity cannot be removed" },
      { status: 409 },
    );
  }

  const statements = [
    ...existing
      .filter((item) => !requested.has(item.productId))
      .map((item) =>
        env.DB.prepare(`
          DELETE FROM inventory
          WHERE booth_id = ? AND product_id = ? AND sold = 0 AND adjusted = 0
        `).bind(parsed.data.boothId, item.productId),
      ),
    ...parsed.data.allocations.map((item) =>
      env.DB.prepare(`
        INSERT INTO inventory (booth_id, product_id, opening, sold, adjusted)
        VALUES (?, ?, ?, 0, 0)
        ON CONFLICT (booth_id, product_id)
        DO UPDATE SET opening = excluded.opening
      `).bind(parsed.data.boothId, item.productId, item.opening),
    ),
    env.DB.prepare(`
      INSERT INTO inventory_configuration_audit (
        organization_id, booth_id, actor_user_id, before_json, after_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      parsed.data.organizationId,
      parsed.data.boothId,
      authorization.access.userId,
      JSON.stringify(existing),
      JSON.stringify(parsed.data.allocations),
      new Date().toISOString(),
    ),
  ];
  await env.DB.batch(statements);
  return Response.json({ saved: true });
}
