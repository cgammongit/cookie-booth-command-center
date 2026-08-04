import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireBoothAccess } from "../../../../../lib/access";
import { broadcastBoothEvent } from "../../../../../lib/booth-live";
import {
  canRecordBoothSales,
  getEffectiveBoothStatus,
} from "../../../../../lib/booth-status";

const saleSchema = z.object({
  paymentMethod: z.enum(["cash", "credit_card", "venmo_paypal"]),
  items: z.array(z.object({
    productId: z.number().int().positive(),
    quantity: z.number().int().positive().max(999),
  })).min(1).max(50),
});

type ProductRow = {
  productId: number;
  name: string;
  price: number;
  remaining: number;
  totalRemaining: number;
};

type RecentSaleRow = {
  id: string;
  paymentMethod: "cash" | "credit_card" | "venmo_paypal";
  boxCount: number;
  totalAmount: number;
  createdAt: string;
  operatorName: string | null;
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ boothId: string }> },
) {
  const { boothId: rawBoothId } = await context.params;
  const boothId = Number(rawBoothId);
  if (!Number.isInteger(boothId) || boothId < 1) {
    return Response.json({ error: "Invalid booth" }, { status: 400 });
  }
  const authorization = await requireBoothAccess(boothId, "view");
  if (authorization.error) return authorization.error;

  const sales = await env.DB.prepare(`
    SELECT s.id, s.payment_method AS paymentMethod, s.box_count AS boxCount,
      s.total_amount AS totalAmount, s.created_at AS createdAt,
      u.display_name AS operatorName
    FROM sales s
    LEFT JOIN users u ON u.id = s.operator_id
    WHERE s.booth_id = ?
      AND NOT EXISTS (SELECT 1 FROM sale_reversals r WHERE r.sale_id = s.id)
    ORDER BY s.created_at DESC, s.id DESC
    LIMIT 5
  `).bind(boothId).all<RecentSaleRow>();

  const ids = sales.results.map((sale) => sale.id);
  const items = ids.length ? await env.DB.prepare(`
    SELECT t.sale_id AS saleId, t.product_id AS productId, p.name,
      t.quantity, t.amount
    FROM transactions t
    JOIN products p ON p.id = t.product_id
    WHERE t.type = 'sale' AND t.sale_id IN (${ids.map(() => "?").join(",")})
    ORDER BY p.name, t.id
  `).bind(...ids).all<{
    saleId: string; productId: number; name: string; quantity: number; amount: number;
  }>() : { results: [] };

  return Response.json({
    sales: sales.results.map((sale) => ({
      ...sale,
      operatorName: sale.operatorName?.trim() || "Booth operator",
      items: items.results.filter((item) => item.saleId === sale.id),
    })),
    permissions: { canReverseSales: authorization.access.canReverseSales },
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ boothId: string }> },
) {
  const { boothId: rawBoothId } = await context.params;
  const boothId = Number(rawBoothId);
  if (!Number.isInteger(boothId) || boothId < 1) {
    return Response.json({ error: "Invalid booth" }, { status: 400 });
  }

  const authorization = await requireBoothAccess(boothId, "operate");
  if (authorization.error) return authorization.error;

  const booth = await env.DB.prepare(`
    SELECT status, starts_at AS startsAt, ends_at AS endsAt,
      archived_at AS archivedAt
    FROM booths WHERE id = ?
  `).bind(boothId).first<{
    status: string;
    startsAt: string;
    endsAt: string;
    archivedAt: string | null;
  }>();
  const effectiveStatus = booth ? getEffectiveBoothStatus(booth) : null;
  if (!booth || booth.archivedAt || !effectiveStatus || !canRecordBoothSales(effectiveStatus)) {
    return Response.json(
      { error: "Sales can be recorded only while this booth is live or pending closure" },
      { status: 409 },
    );
  }

  const parsed = saleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message || "Invalid sale" },
      { status: 400 },
    );
  }

  const quantities = new Map<number, number>();
  for (const item of parsed.data.items) {
    quantities.set(item.productId, (quantities.get(item.productId) || 0) + item.quantity);
  }
  const productIds = [...quantities.keys()];
  const placeholders = productIds.map(() => "?").join(",");
  const products = await env.DB.prepare(`
    SELECT p.id AS productId, p.name, p.price,
      (i.opening + i.adjusted - i.sold) AS remaining,
      tb.total_remaining AS totalRemaining
    FROM products p
    JOIN inventory i ON i.product_id = p.id AND i.booth_id = ?
    JOIN troop_inventory_balances tb
      ON tb.product_id = p.id AND tb.organization_id = p.organization_id
    WHERE p.active = 1 AND p.id IN (${placeholders})
  `).bind(boothId, ...productIds).all<ProductRow>();

  if (products.results.length !== productIds.length) {
    return Response.json(
      { error: "One or more products are unavailable at this booth" },
      { status: 409 },
    );
  }

  let boxCount = 0;
  let totalAmount = 0;
  for (const product of products.results) {
    const quantity = quantities.get(Number(product.productId)) || 0;
    if (quantity > Number(product.remaining) || quantity > Number(product.totalRemaining)) {
      return Response.json(
        { error: `${product.name} does not have enough booth inventory for this sale` },
        { status: 409 },
      );
    }
    boxCount += quantity;
    totalAmount += quantity * Number(product.price);
  }
  totalAmount = Math.round(totalAmount * 100) / 100;

  const saleId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const statements = [
    env.DB.prepare(`
      INSERT INTO sales (
        id, booth_id, operator_id, payment_method, box_count, total_amount, created_at
      ) SELECT ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM booths b WHERE b.id = ? AND b.archived_at IS NULL
          AND b.status <> 'closed'
          AND NOT EXISTS (SELECT 1 FROM reconciliations r WHERE r.booth_id = b.id)
      )
    `).bind(
      saleId,
      boothId,
      authorization.access.userId,
      parsed.data.paymentMethod,
      boxCount,
      totalAmount,
      createdAt,
      boothId,
    ),
  ];

  for (const product of products.results) {
    const quantity = quantities.get(Number(product.productId)) || 0;
    const lineAmount = Math.round(quantity * Number(product.price) * 100) / 100;
    statements.push(
      env.DB.prepare(`
        UPDATE inventory SET sold = sold + ?
        WHERE booth_id = ? AND product_id = ?
          AND (opening + adjusted - sold) >= ?
          AND EXISTS (SELECT 1 FROM sales WHERE id = ?)
      `).bind(quantity, boothId, product.productId, quantity, saleId),
      env.DB.prepare(`
        UPDATE troop_inventory_balances
        SET total_remaining = total_remaining - ?, updated_at = ?
        WHERE organization_id = ? AND product_id = ? AND total_remaining >= ?
          AND EXISTS (SELECT 1 FROM sales WHERE id = ?)
      `).bind(
        quantity,
        createdAt,
        authorization.access.organizationId,
        product.productId,
        quantity,
        saleId,
      ),
      env.DB.prepare(`
        INSERT INTO transactions (
          id, sale_id, booth_id, product_id, operator_id,
          type, quantity, amount, reason, created_at
        ) SELECT ?, ?, ?, ?, ?, 'sale', ?, ?, NULL, ?
          WHERE EXISTS (SELECT 1 FROM sales WHERE id = ?)
      `).bind(
        crypto.randomUUID(),
        saleId,
        boothId,
        product.productId,
        authorization.access.userId,
        quantity,
        lineAmount,
        createdAt,
        saleId,
      ),
      env.DB.prepare(`
        INSERT INTO inventory_ledger (
          organization_id, product_id, booth_id, actor_user_id,
          movement_type, total_delta, available_delta, booth_delta,
          reason, reference, created_at
        ) SELECT ?, ?, ?, ?, 'booth_sale', ?, 0, ?, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM sales WHERE id = ?)
      `).bind(
        authorization.access.organizationId,
        product.productId,
        boothId,
        authorization.access.userId,
        -quantity,
        -quantity,
        `Sale paid by ${parsed.data.paymentMethod}`,
        saleId,
        createdAt,
        saleId,
      ),
    );
  }
  statements.push(env.DB.prepare(`
    UPDATE booths SET sales_revision = sales_revision + 1
    WHERE id = ? AND EXISTS (SELECT 1 FROM sales WHERE id = ?)
  `).bind(boothId, saleId));

  try {
    const results = await env.DB.batch(statements);
    if (Number(results[0]?.meta?.changes || 0) !== 1) {
      return Response.json(
        { error: "The booth changed before the sale was recorded. Review it and try again." },
        { status: 409 },
      );
    }
  } catch {
    return Response.json(
      { error: "The sale could not be completed because inventory changed. Review the counts and try again." },
      { status: 409 },
    );
  }

  await broadcastBoothEvent(
    authorization.access.organizationId,
    boothId,
    ["sales", "inventory", "payments"],
  ).catch(() => undefined);

  return Response.json({
    sale: {
      id: saleId,
      paymentMethod: parsed.data.paymentMethod,
      boxCount,
      totalAmount,
      createdAt,
    },
  }, { status: 201 });
}
