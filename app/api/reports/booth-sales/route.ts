import { env } from "cloudflare:workers";
import { z } from "zod";
import { getOrganizationAccess } from "../../../../lib/access";

const querySchema = z.object({
  organizationId: z.coerce.number().int().positive(),
  boothIds: z.string().trim().optional().default(""),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
});

type BoothOption = {
  id: number;
  name: string;
  startsAt: string;
  status: string;
  archivedAt: string | null;
};

type SaleRow = {
  boothId: number;
  boothName: string;
  saleCount: number;
  boxCount: number;
  gross: number;
  cash: number;
  creditCard: number;
  venmoPaypal: number;
};

type ItemRow = {
  productId: number;
  productName: string;
  boxCount: number;
  gross: number;
};

type ReconciliationRow = {
  boothId: number;
  boothName: string;
  closedAt: string;
  expectedCash: number;
  cashTurnedIn: number;
  cashDiscrepancy: number;
  inventoryDiscrepancy: number;
  notes: string | null;
};

function parseBoothIds(value: string) {
  if (!value) return [];
  const ids = value.split(",").map(Number);
  if (ids.length > 250 || ids.some((id) => !Number.isInteger(id) || id < 1)) {
    return null;
  }
  return [...new Set(ids)];
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    organizationId: url.searchParams.get("organizationId"),
    boothIds: url.searchParams.get("boothIds") || "",
    from: url.searchParams.get("from") || undefined,
    to: url.searchParams.get("to") || undefined,
  });
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message || "Invalid report filters" },
      { status: 400 },
    );
  }

  const access = await getOrganizationAccess(parsed.data.organizationId);
  if (!access || (access.role !== "admin" && access.role !== "auditor")) {
    return Response.json(
      { error: "Report access requires an administrator or auditor role" },
      { status: 403 },
    );
  }

  const booths = await env.DB.prepare(`
    SELECT id, name, starts_at AS startsAt, status, archived_at AS archivedAt
    FROM booths
    WHERE organization_id = ?
    ORDER BY starts_at DESC, name
  `).bind(parsed.data.organizationId).all<BoothOption>();

  const boothIds = parseBoothIds(parsed.data.boothIds);
  if (!boothIds) {
    return Response.json({ error: "Invalid booth selection" }, { status: 400 });
  }
  if (!boothIds.length) {
    return Response.json({ booths: booths.results, report: null });
  }

  const allowedBoothIds = new Set(booths.results.map((booth) => Number(booth.id)));
  if (boothIds.some((boothId) => !allowedBoothIds.has(boothId))) {
    return Response.json(
      { error: "One or more selected booths do not belong to this organization" },
      { status: 403 },
    );
  }
  if (parsed.data.from && parsed.data.to && parsed.data.from > parsed.data.to) {
    return Response.json(
      { error: "The report start date must be on or before the end date" },
      { status: 400 },
    );
  }

  const placeholders = boothIds.map(() => "?").join(",");
  const dateClauses: string[] = [];
  const dateBindings: string[] = [];
  if (parsed.data.from) {
    dateClauses.push("s.created_at >= ?");
    dateBindings.push(`${parsed.data.from}T00:00:00.000Z`);
  }
  if (parsed.data.to) {
    dateClauses.push("s.created_at < ?");
    const exclusiveEnd = new Date(`${parsed.data.to}T00:00:00.000Z`);
    exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);
    dateBindings.push(exclusiveEnd.toISOString());
  }
  const dateSql = dateClauses.length ? `AND ${dateClauses.join(" AND ")}` : "";

  const [sales, items, reconciliations] = await Promise.all([
    env.DB.prepare(`
      SELECT b.id AS boothId, b.name AS boothName,
        COUNT(s.id) AS saleCount,
        COALESCE(SUM(s.box_count), 0) AS boxCount,
        COALESCE(SUM(s.total_amount), 0) AS gross,
        COALESCE(SUM(CASE WHEN s.payment_method = 'cash' THEN s.total_amount ELSE 0 END), 0) AS cash,
        COALESCE(SUM(CASE WHEN s.payment_method = 'credit_card' THEN s.total_amount ELSE 0 END), 0) AS creditCard,
        COALESCE(SUM(CASE WHEN s.payment_method = 'venmo_paypal' THEN s.total_amount ELSE 0 END), 0) AS venmoPaypal
      FROM booths b
      LEFT JOIN sales s ON s.booth_id = b.id ${dateSql}
      WHERE b.organization_id = ? AND b.id IN (${placeholders})
      GROUP BY b.id, b.name
      ORDER BY gross DESC, b.name
    `).bind(...dateBindings, parsed.data.organizationId, ...boothIds).all<SaleRow>(),
    env.DB.prepare(`
      SELECT p.id AS productId, p.name AS productName,
        COALESCE(SUM(t.quantity), 0) AS boxCount,
        COALESCE(SUM(t.amount), 0) AS gross
      FROM transactions t
      JOIN sales s ON s.id = t.sale_id
      JOIN products p ON p.id = t.product_id
      JOIN booths b ON b.id = s.booth_id
      WHERE b.organization_id = ?
        AND s.booth_id IN (${placeholders})
        AND t.type = 'sale'
        ${dateSql}
      GROUP BY p.id, p.name
      ORDER BY boxCount DESC, p.name
    `).bind(
      parsed.data.organizationId,
      ...boothIds,
      ...dateBindings,
    ).all<ItemRow>(),
    env.DB.prepare(`
      SELECT b.id AS boothId, b.name AS boothName, r.closed_at AS closedAt,
        r.expected_cash_total AS expectedCash,
        r.cash_total AS cashTurnedIn,
        r.cash_discrepancy AS cashDiscrepancy,
        r.inventory_discrepancy_count AS inventoryDiscrepancy,
        r.notes
      FROM reconciliations r
      JOIN booths b ON b.id = r.booth_id
      WHERE b.organization_id = ? AND b.id IN (${placeholders})
      ORDER BY r.closed_at DESC, b.name
    `).bind(parsed.data.organizationId, ...boothIds).all<ReconciliationRow>(),
  ]);

  const totals = sales.results.reduce(
    (total, booth) => ({
      saleCount: total.saleCount + Number(booth.saleCount),
      boxCount: total.boxCount + Number(booth.boxCount),
      gross: total.gross + Number(booth.gross),
      cash: total.cash + Number(booth.cash),
      creditCard: total.creditCard + Number(booth.creditCard),
      venmoPaypal: total.venmoPaypal + Number(booth.venmoPaypal),
    }),
    { saleCount: 0, boxCount: 0, gross: 0, cash: 0, creditCard: 0, venmoPaypal: 0 },
  );

  return Response.json({
    booths: booths.results,
    report: {
      generatedAt: new Date().toISOString(),
      filters: {
        boothIds,
        from: parsed.data.from || null,
        to: parsed.data.to || null,
      },
      totals: {
        ...totals,
        averageSale: totals.saleCount ? totals.gross / totals.saleCount : 0,
      },
      boothSales: sales.results,
      itemSales: items.results,
      reconciliations: reconciliations.results,
    },
  });
}
