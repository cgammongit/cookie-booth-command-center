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

  try {
    const result = await env.DB.prepare(`
      UPDATE products
      SET name = ?, barcode = ?, price = ?, active = ?, updated_at = ?
      WHERE id = ? AND organization_id = ?
    `).bind(
      parsed.data.name,
      parsed.data.barcode,
      parsed.data.price,
      parsed.data.active ? 1 : 0,
      new Date().toISOString(),
      productId,
      parsed.data.organizationId,
    ).run();
    if (!result.meta.changes) {
      return Response.json({ error: "Product not found" }, { status: 404 });
    }
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
