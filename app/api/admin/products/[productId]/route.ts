import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireOrganizationAdmin } from "../../../../../lib/access";

const updateSchema = z.object({
  organizationId: z.number().int().positive(),
  name: z.string().trim().min(2).max(100),
  barcode: z.string().trim().min(3).max(80),
  price: z.number().positive().max(100),
  active: z.boolean(),
}).strict();

export async function PATCH(
  request: Request,
  context: { params: Promise<{ productId: string }> },
) {
  const { productId: rawProductId } = await context.params;
  const productId = Number(rawProductId);
  if (!Number.isInteger(productId) || productId < 1) {
    return Response.json({ error: "Invalid product" }, { status: 400 });
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
      { error: parsed.error.issues[0]?.message || "Invalid product" },
      { status: 400 },
    );
  }
  const authorization = await requireOrganizationAdmin(parsed.data.organizationId);
  if (authorization.error) return authorization.error;

  const before = await env.DB.prepare(`
    SELECT id, name, barcode, price, active
    FROM products WHERE id = ? AND organization_id = ?
  `).bind(productId, parsed.data.organizationId).first<{
    id: number;
    name: string;
    barcode: string;
    price: number;
    active: number;
  }>();
  if (!before) {
    return Response.json({ error: "Product not found" }, { status: 404 });
  }

  try {
    const now = new Date().toISOString();
    const after = {
      id: productId,
      name: parsed.data.name,
      barcode: parsed.data.barcode,
      price: parsed.data.price,
      active: parsed.data.active ? 1 : 0,
    };
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE products
        SET name = ?, barcode = ?, price = ?, active = ?, updated_at = ?
        WHERE id = ? AND organization_id = ?
      `).bind(
        after.name,
        after.barcode,
        after.price,
        after.active,
        now,
        productId,
        parsed.data.organizationId,
      ),
      env.DB.prepare(`
        INSERT INTO product_catalog_audit (
          organization_id, product_id, actor_user_id, before_json, after_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).bind(
        parsed.data.organizationId,
        productId,
        authorization.access.userId,
        JSON.stringify(before),
        JSON.stringify(after),
        now,
      ),
    ]);
    return Response.json({ updated: true });
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
