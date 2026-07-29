import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireOrganizationPermission } from "../../../../lib/access";

const querySchema = z.object({
  organizationId: z.coerce.number().int().positive(),
});

const createSchema = z.object({
  organizationId: z.number().int().positive(),
  name: z.string().trim().min(2).max(100),
  barcode: z.string().trim().min(3).max(80),
  price: z.number().positive().max(100),
}).strict();

export async function GET(request: Request) {
  const parsed = querySchema.safeParse({
    organizationId: new URL(request.url).searchParams.get("organizationId"),
  });
  if (!parsed.success) {
    return Response.json({ error: "A valid organization is required" }, { status: 400 });
  }
  const authorization = await requireOrganizationPermission(
    parsed.data.organizationId,
    "product.manage",
  );
  if (authorization.error) return authorization.error;

  const result = await env.DB.prepare(`
    SELECT p.id, p.name, p.barcode, p.price, p.active,
      p.updated_at AS updatedAt,
      (SELECT COUNT(*) FROM inventory i WHERE i.product_id = p.id) AS boothCount
    FROM products p
    WHERE p.organization_id = ?
    ORDER BY p.active DESC, p.name
  `).bind(parsed.data.organizationId).all();
  return Response.json({ products: result.results });
}

export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message || "Invalid product" },
      { status: 400 },
    );
  }
  const authorization = await requireOrganizationPermission(
    parsed.data.organizationId,
    "product.manage",
  );
  if (authorization.error) return authorization.error;
  const now = new Date().toISOString();

  try {
    const result = await env.DB.prepare(`
      INSERT INTO products (organization_id, name, barcode, price, active, updated_at)
      VALUES (?, ?, ?, ?, 1, ?)
    `).bind(
      parsed.data.organizationId,
      parsed.data.name,
      parsed.data.barcode,
      parsed.data.price,
      now,
    ).run();
    const productId = Number(result.meta.last_row_id);
    await env.DB.prepare(`
      INSERT OR IGNORE INTO troop_inventory_balances (
        organization_id, product_id, total_remaining, available, updated_at
      ) VALUES (?, ?, 0, 0, ?)
    `).bind(parsed.data.organizationId, productId, now).run();
    return Response.json({ productId }, { status: 201 });
  } catch (error) {
    if (String(error).toLowerCase().includes("unique")) {
      return Response.json(
        { error: "That barcode already belongs to another product" },
        { status: 409 },
      );
    }
    throw error;
  }
}
