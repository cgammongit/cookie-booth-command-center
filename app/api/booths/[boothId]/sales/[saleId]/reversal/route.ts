import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireBoothAccess } from "../../../../../../../lib/access";
import { broadcastBoothEvent } from "../../../../../../../lib/booth-live";
import { canRecordBoothSales, getEffectiveBoothStatus } from "../../../../../../../lib/booth-status";

const reversalSchema = z.object({
  reasonCode: z.enum([
    "wrong_cookies", "wrong_quantity", "wrong_payment_method", "duplicate_sale", "other",
  ]),
  reasonDetail: z.string().trim().max(200).optional(),
}).strict().superRefine((value, context) => {
  if (value.reasonCode === "other" && (value.reasonDetail?.length || 0) < 3) {
    context.addIssue({ code: "custom", path: ["reasonDetail"], message: "Explain the other reason" });
  }
  if (value.reasonCode !== "other" && value.reasonDetail) {
    context.addIssue({ code: "custom", path: ["reasonDetail"], message: "An explanation is used only with Other" });
  }
});

type SaleRow = {
  id: string; boothId: number; organizationId: number; paymentMethod: string;
  totalAmount: number; status: string; startsAt: string; endsAt: string;
  archivedAt: string | null; salesRevision: number;
};
type LineRow = { productId: number; quantity: number };

export async function POST(
  request: Request,
  context: { params: Promise<{ boothId: string; saleId: string }> },
) {
  const { boothId: rawBoothId, saleId } = await context.params;
  const boothId = Number(rawBoothId);
  if (!Number.isInteger(boothId) || boothId < 1 || !/^[0-9a-f-]{36}$/i.test(saleId)) {
    return Response.json({ error: "Invalid sale" }, { status: 400 });
  }
  const authorization = await requireBoothAccess(boothId, "reverseSales");
  if (authorization.error) return authorization.error;
  const parsed = reversalSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message || "Invalid reversal" }, { status: 400 });
  }

  const sale = await env.DB.prepare(`
    SELECT s.id, s.booth_id AS boothId, b.organization_id AS organizationId,
      s.payment_method AS paymentMethod, s.total_amount AS totalAmount,
      b.status, b.starts_at AS startsAt, b.ends_at AS endsAt,
      b.archived_at AS archivedAt, b.sales_revision AS salesRevision
    FROM sales s JOIN booths b ON b.id = s.booth_id
    WHERE s.id = ? AND s.booth_id = ? AND b.organization_id = ?
  `).bind(saleId, boothId, authorization.access.organizationId).first<SaleRow>();
  if (!sale) return Response.json({ error: "Sale not found" }, { status: 404 });
  const effectiveStatus = getEffectiveBoothStatus(sale);
  if (sale.archivedAt || !canRecordBoothSales(effectiveStatus)) {
    return Response.json({ error: "Sales cannot be reversed after this booth is closed or reconciled" }, { status: 409 });
  }
  const lines = await env.DB.prepare(`
    SELECT product_id AS productId, quantity FROM transactions
    WHERE sale_id = ? AND booth_id = ? AND type = 'sale'
  `).bind(saleId, boothId).all<LineRow>();
  if (!lines.results.length) {
    return Response.json({ error: "This sale has no reversible inventory records" }, { status: 409 });
  }

  const reversalId = crypto.randomUUID();
  const reversedAt = new Date().toISOString();
  const reasonDetail = parsed.data.reasonCode === "other" ? parsed.data.reasonDetail!.trim() : null;
  const statements = [env.DB.prepare(`
    INSERT INTO sale_reversals (
      id, sale_id, organization_id, booth_id, reversed_by_user_id,
      reversed_by_clerk_user_id, reason_code, reason_detail, reversed_at
    )
    SELECT ?, s.id, b.organization_id, b.id, ?, ?, ?, ?, ?
    FROM sales s JOIN booths b ON b.id = s.booth_id
    WHERE s.id = ? AND s.booth_id = ? AND b.organization_id = ?
      AND b.sales_revision = ? AND b.archived_at IS NULL AND b.status <> 'closed'
      AND NOT EXISTS (SELECT 1 FROM reconciliations rc WHERE rc.booth_id = b.id)
      AND NOT EXISTS (SELECT 1 FROM sale_reversals prior WHERE prior.sale_id = s.id)
      AND NOT EXISTS (
        SELECT 1 FROM transactions t
        JOIN inventory i ON i.booth_id = t.booth_id AND i.product_id = t.product_id
        WHERE t.sale_id = s.id AND t.type = 'sale' AND i.sold < t.quantity
      )
      AND (SELECT COALESCE(SUM(active.total_amount), 0) FROM sales active
        WHERE active.booth_id = b.id AND active.payment_method = s.payment_method
          AND NOT EXISTS (SELECT 1 FROM sale_reversals ar WHERE ar.sale_id = active.id)
      ) >= s.total_amount
  `).bind(
    reversalId, authorization.access.userId, authorization.access.clerkUserId,
    parsed.data.reasonCode, reasonDetail, reversedAt, saleId, boothId,
    authorization.access.organizationId, sale.salesRevision,
  )];

  for (const line of lines.results) {
    statements.push(
      env.DB.prepare(`UPDATE inventory SET sold = sold - ?
        WHERE booth_id = ? AND product_id = ? AND sold >= ?
          AND EXISTS (SELECT 1 FROM sale_reversals WHERE id = ?)`)
        .bind(line.quantity, boothId, line.productId, line.quantity, reversalId),
      env.DB.prepare(`UPDATE troop_inventory_balances
        SET total_remaining = total_remaining + ?, updated_at = ?
        WHERE organization_id = ? AND product_id = ?
          AND EXISTS (SELECT 1 FROM sale_reversals WHERE id = ?)`)
        .bind(line.quantity, reversedAt, authorization.access.organizationId, line.productId, reversalId),
      env.DB.prepare(`INSERT INTO inventory_ledger (
        organization_id, product_id, booth_id, actor_user_id, movement_type,
        total_delta, available_delta, booth_delta, reason, reference, created_at
      ) SELECT ?, ?, ?, ?, 'correction_in', ?, 0, ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM sale_reversals WHERE id = ?)`)
        .bind(
          authorization.access.organizationId, line.productId, boothId,
          authorization.access.userId, line.quantity, line.quantity,
          `Sale reversal: ${parsed.data.reasonCode}`, `sale-reversal:${reversalId}`,
          reversedAt, reversalId,
        ),
    );
  }
  statements.push(env.DB.prepare(`UPDATE booths SET sales_revision = sales_revision + 1
    WHERE id = ? AND sales_revision = ?
      AND EXISTS (SELECT 1 FROM sale_reversals WHERE id = ?)`)
    .bind(boothId, sale.salesRevision, reversalId));

  try {
    const results = await env.DB.batch(statements);
    if (Number(results[0]?.meta?.changes || 0) !== 1) {
      return Response.json({ error: "This sale was already reversed or the booth changed" }, { status: 409 });
    }
  } catch {
    return Response.json({ error: "The sale could not be reversed because booth data changed" }, { status: 409 });
  }

  await broadcastBoothEvent(
    authorization.access.organizationId, boothId,
    ["sales", "inventory", "payments", "reconciliation"],
  ).catch(() => undefined);
  return Response.json({ reversal: { id: reversalId, saleId, reversedAt } }, { status: 201 });
}
