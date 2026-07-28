import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireOrganizationAdmin } from "../../../../lib/access";

const querySchema = z.object({
  organizationId: z.coerce.number().int().positive(),
});

const movementSchema = z.object({
  organizationId: z.number().int().positive(),
  productId: z.number().int().positive(),
  type: z.enum([
    "initial_order",
    "replenishment",
    "trade_in",
    "trade_out",
    "council_return",
    "damage",
    "loss",
    "correction_in",
    "correction_out",
  ]),
  quantity: z.number().int().positive().max(100000),
  reason: z.string().trim().max(500).optional().default(""),
  reference: z.string().trim().max(120).optional().default(""),
}).strict();

const additions = new Set(["initial_order", "replenishment", "trade_in", "correction_in"]);

export async function GET(request: Request) {
  const parsed = querySchema.safeParse({
    organizationId: new URL(request.url).searchParams.get("organizationId"),
  });
  if (!parsed.success) {
    return Response.json({ error: "A valid organization is required" }, { status: 400 });
  }
  const authorization = await requireOrganizationAdmin(parsed.data.organizationId);
  if (authorization.error) return authorization.error;

  const [balances, movements] = await Promise.all([
    env.DB.prepare(`
      SELECT p.id AS productId, p.name, p.barcode, p.active,
        COALESCE(b.total_remaining, 0) AS totalRemaining,
        COALESCE(b.available, 0) AS available,
        COALESCE(b.total_remaining - b.available, 0) AS atBooths,
        COALESCE((
          SELECT SUM(-l.total_delta) FROM inventory_ledger l
          WHERE l.organization_id = p.organization_id
            AND l.product_id = p.id
            AND l.movement_type IN ('trade_out','council_return','damage','loss','correction_out')
        ), 0) AS removed
      FROM products p
      LEFT JOIN troop_inventory_balances b
        ON b.organization_id = p.organization_id AND b.product_id = p.id
      WHERE p.organization_id = ?
      ORDER BY p.active DESC, p.name
    `).bind(parsed.data.organizationId).all(),
    env.DB.prepare(`
      SELECT l.id, l.product_id AS productId, p.name AS productName,
        l.booth_id AS boothId, b.name AS boothName, l.movement_type AS type,
        l.total_delta AS totalDelta, l.available_delta AS availableDelta,
        l.booth_delta AS boothDelta, l.reason, l.reference,
        l.created_at AS createdAt, u.display_name AS actorName
      FROM inventory_ledger l
      JOIN products p ON p.id = l.product_id
      LEFT JOIN booths b ON b.id = l.booth_id
      LEFT JOIN users u ON u.id = l.actor_user_id
      WHERE l.organization_id = ?
      ORDER BY l.id DESC
      LIMIT 100
    `).bind(parsed.data.organizationId).all(),
  ]);

  return Response.json({ balances: balances.results, movements: movements.results });
}

export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = movementSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message || "Invalid stock movement" },
      { status: 400 },
    );
  }
  const authorization = await requireOrganizationAdmin(parsed.data.organizationId);
  if (authorization.error) return authorization.error;

  const product = await env.DB.prepare(`
    SELECT id FROM products WHERE id = ? AND organization_id = ?
  `).bind(parsed.data.productId, parsed.data.organizationId).first();
  if (!product) return Response.json({ error: "Product not found" }, { status: 404 });

  const positive = additions.has(parsed.data.type);
  const delta = positive ? parsed.data.quantity : -parsed.data.quantity;
  const now = new Date().toISOString();
  const balance = await env.DB.prepare(`
    SELECT total_remaining AS totalRemaining, available
    FROM troop_inventory_balances
    WHERE organization_id = ? AND product_id = ?
  `).bind(parsed.data.organizationId, parsed.data.productId).first<{
    totalRemaining: number;
    available: number;
  }>();
  if (
    !positive &&
    (
      !balance ||
      Number(balance.totalRemaining) < parsed.data.quantity ||
      Number(balance.available) < parsed.data.quantity
    )
  ) {
    return Response.json(
      { error: "This removal exceeds the troop inventory currently available" },
      { status: 409 },
    );
  }

  const balanceMutation = positive
    ? env.DB.prepare(`
        INSERT INTO troop_inventory_balances (
          organization_id, product_id, total_remaining, available, updated_at
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (organization_id, product_id) DO UPDATE SET
          total_remaining = total_remaining + excluded.total_remaining,
          available = available + excluded.available,
          updated_at = excluded.updated_at
      `).bind(
        parsed.data.organizationId,
        parsed.data.productId,
        delta,
        delta,
        now,
      )
    : env.DB.prepare(`
        UPDATE troop_inventory_balances
        SET total_remaining = total_remaining + ?,
          available = available + ?,
          updated_at = ?
        WHERE organization_id = ? AND product_id = ?
      `).bind(
        delta,
        delta,
        now,
        parsed.data.organizationId,
        parsed.data.productId,
      );

  try {
    await env.DB.batch([
      balanceMutation,
      env.DB.prepare(`
        INSERT INTO inventory_ledger (
          organization_id, product_id, actor_user_id, movement_type,
          total_delta, available_delta, booth_delta, reason, reference, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
      `).bind(
        parsed.data.organizationId,
        parsed.data.productId,
        authorization.access.userId,
        parsed.data.type,
        delta,
        delta,
        parsed.data.reason || null,
        parsed.data.reference || null,
        now,
      ),
    ]);
  } catch (error) {
    if (String(error).toLowerCase().includes("check constraint")) {
      return Response.json(
        { error: "This removal exceeds the troop inventory currently available" },
        { status: 409 },
      );
    }
    throw error;
  }
  return Response.json({ recorded: true }, { status: 201 });
}
