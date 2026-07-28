import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireBoothAccess } from "../../../../../lib/access";
import { getEffectiveBoothStatus } from "../../../../../lib/booth-status";

const reconciliationSchema = z.object({
  cashTurnedIn: z.number().finite().min(0).max(1000000),
  finalCounts: z.array(z.object({
    productId: z.number().int().positive(),
    quantity: z.number().int().min(0).max(10000),
  }).strict()).max(250),
  notes: z.string().trim().max(1000).optional().default(""),
}).strict();

type InventoryRow = {
  productId: number;
  name: string;
  opening: number;
  sold: number;
  adjusted: number;
  expectedRemaining: number;
};

function money(value: number) {
  return Math.round(value * 100) / 100;
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

  const authorization = await requireBoothAccess(boothId, "reconcile");
  if (authorization.error) return authorization.error;

  const parsed = reconciliationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message || "Invalid reconciliation" },
      { status: 400 },
    );
  }

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
  if (
    !booth ||
    booth.archivedAt ||
    getEffectiveBoothStatus(booth) !== "pending_closure"
  ) {
    return Response.json(
      { error: "A booth can be closed only after it enters Pending Closure" },
      { status: 409 },
    );
  }

  const existingReconciliation = await env.DB.prepare(
    "SELECT id FROM reconciliations WHERE booth_id = ?",
  ).bind(boothId).first();
  if (existingReconciliation) {
    return Response.json({ error: "This booth has already been reconciled" }, { status: 409 });
  }

  const inventory = await env.DB.prepare(`
    SELECT p.id AS productId, p.name, i.opening, i.sold, i.adjusted,
      (i.opening + i.adjusted - i.sold) AS expectedRemaining
    FROM inventory i
    JOIN products p ON p.id = i.product_id
    WHERE i.booth_id = ?
    ORDER BY p.name
  `).bind(boothId).all<InventoryRow>();

  const finalCounts = new Map<number, number>();
  for (const item of parsed.data.finalCounts) {
    if (finalCounts.has(item.productId)) {
      return Response.json(
        { error: "Each product may be counted only once" },
        { status: 400 },
      );
    }
    finalCounts.set(item.productId, item.quantity);
  }
  if (
    finalCounts.size !== inventory.results.length ||
    inventory.results.some((item) => !finalCounts.has(Number(item.productId)))
  ) {
    return Response.json(
      { error: "Enter a final count for every product at this booth" },
      { status: 400 },
    );
  }

  const paymentTotals = await env.DB.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN total_amount ELSE 0 END), 0) AS cash,
      COALESCE(SUM(CASE WHEN payment_method = 'credit_card' THEN total_amount ELSE 0 END), 0) AS creditCard,
      COALESCE(SUM(CASE WHEN payment_method = 'venmo_paypal' THEN total_amount ELSE 0 END), 0) AS venmoPaypal,
      COALESCE(SUM(total_amount), 0) AS gross
    FROM sales WHERE booth_id = ?
  `).bind(boothId).first<{
    cash: number;
    creditCard: number;
    venmoPaypal: number;
    gross: number;
  }>();

  const expectedCash = money(Number(paymentTotals?.cash || 0));
  const cashTurnedIn = money(parsed.data.cashTurnedIn);
  const cashDiscrepancy = money(cashTurnedIn - expectedCash);
  const expectedBoxCount = inventory.results.reduce(
    (total, item) => total + Number(item.expectedRemaining),
    0,
  );
  const actualBoxCount = inventory.results.reduce(
    (total, item) => total + (finalCounts.get(Number(item.productId)) || 0),
    0,
  );
  const inventoryDiscrepancyCount = actualBoxCount - expectedBoxCount;
  if (
    (cashDiscrepancy !== 0 || inventoryDiscrepancyCount !== 0) &&
    parsed.data.notes.length < 5
  ) {
    return Response.json(
      { error: "Explain cash or inventory discrepancies before closing the booth" },
      { status: 400 },
    );
  }

  const closedAt = new Date().toISOString();
  const reconciliationId =
    Date.now() * 1000 + crypto.getRandomValues(new Uint16Array(1))[0] % 1000;
  const statements = [
    env.DB.prepare(`
      INSERT INTO reconciliations (
        id, booth_id, closed_by, cash_total, expected_cash_total, cash_discrepancy,
        digital_total, credit_card_total, venmo_paypal_total, gross_total,
        expected_box_count, actual_box_count, inventory_discrepancy_count,
        notes, closed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      reconciliationId,
      boothId,
      authorization.access.userId,
      cashTurnedIn,
      expectedCash,
      cashDiscrepancy,
      money(Number(paymentTotals?.creditCard || 0) + Number(paymentTotals?.venmoPaypal || 0)),
      money(Number(paymentTotals?.creditCard || 0)),
      money(Number(paymentTotals?.venmoPaypal || 0)),
      money(Number(paymentTotals?.gross || 0)),
      expectedBoxCount,
      actualBoxCount,
      inventoryDiscrepancyCount,
      parsed.data.notes || null,
      closedAt,
    ),
  ];

  for (const item of inventory.results) {
    const productId = Number(item.productId);
    const expected = Number(item.expectedRemaining);
    const actual = finalCounts.get(productId) || 0;
    const discrepancy = actual - expected;

    statements.push(
      env.DB.prepare(`
        INSERT INTO reconciliation_items (
          reconciliation_id, product_id, expected_remaining,
          actual_remaining, discrepancy, returned_to_troop
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).bind(reconciliationId, productId, expected, actual, discrepancy, actual),
      env.DB.prepare(`
        UPDATE troop_inventory_balances
        SET total_remaining = total_remaining + ?,
          available = available + ?,
          updated_at = ?
        WHERE organization_id = ? AND product_id = ?
          AND total_remaining + ? >= 0
      `).bind(
        discrepancy,
        actual,
        closedAt,
        authorization.access.organizationId,
        productId,
        discrepancy,
      ),
      env.DB.prepare(`
        UPDATE inventory
        SET adjusted = sold - opening
        WHERE booth_id = ? AND product_id = ?
          AND (opening + adjusted - sold) = ?
      `).bind(boothId, productId, expected),
    );

    if (discrepancy !== 0) {
      statements.push(
        env.DB.prepare(`
          INSERT INTO inventory_ledger (
            organization_id, product_id, booth_id, actor_user_id, movement_type,
            total_delta, available_delta, booth_delta, reason, reference, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
        `).bind(
          authorization.access.organizationId,
          productId,
          boothId,
          authorization.access.userId,
          discrepancy > 0 ? "correction_in" : "correction_out",
          discrepancy,
          discrepancy,
          parsed.data.notes,
          `reconciliation:${reconciliationId}`,
          closedAt,
        ),
      );
    }
    if (actual > 0) {
      statements.push(
        env.DB.prepare(`
          INSERT INTO inventory_ledger (
            organization_id, product_id, booth_id, actor_user_id, movement_type,
            total_delta, available_delta, booth_delta, reason, reference, created_at
          ) VALUES (?, ?, ?, ?, 'booth_return', 0, ?, ?, ?, ?, ?)
        `).bind(
          authorization.access.organizationId,
          productId,
          boothId,
          authorization.access.userId,
          actual,
          -actual,
          "Unsold inventory returned during booth reconciliation",
          `reconciliation:${reconciliationId}`,
          closedAt,
        ),
      );
    }
  }

  statements.push(
    env.DB.prepare(`
      UPDATE booths SET status = 'closed'
      WHERE id = ? AND status <> 'closed' AND archived_at IS NULL
    `).bind(boothId),
  );

  try {
    await env.DB.batch(statements);
  } catch {
    return Response.json(
      { error: "The booth changed while it was being closed. Review the counts and try again." },
      { status: 409 },
    );
  }

  return Response.json({
    reconciliation: {
      id: reconciliationId,
      cashTurnedIn,
      expectedCash,
      cashDiscrepancy,
      creditCardTotal: money(Number(paymentTotals?.creditCard || 0)),
      venmoPaypalTotal: money(Number(paymentTotals?.venmoPaypal || 0)),
      grossTotal: money(Number(paymentTotals?.gross || 0)),
      expectedBoxCount,
      actualBoxCount,
      inventoryDiscrepancyCount,
      closedAt,
    },
  }, { status: 201 });
}
