import { env } from "cloudflare:workers";
import { requireBoothAccess } from "../../../../../lib/access";
import { calculateBoothScoutCredit, sumRational } from "../../../../../lib/scout-credit";

export async function GET(_request: Request, context: { params: Promise<{ boothId: string }> }) {
  const boothId = Number((await context.params).boothId);
  if (!Number.isInteger(boothId) || boothId < 1) return Response.json({ error: "Invalid booth" }, { status: 400 });
  const authorization = await requireBoothAccess(boothId, "reconcile");
  if (authorization.error) return authorization.error;
  const booth = await env.DB.prepare("SELECT starts_at AS startsAt, ends_at AS endsAt FROM booths WHERE id = ? AND organization_id = ?")
    .bind(boothId, authorization.access.organizationId).first<{ startsAt: string; endsAt: string }>();
  if (!booth) return Response.json({ error: "Booth not found" }, { status: 404 });
  const calculated = await calculateBoothScoutCredit(env.DB, authorization.access.organizationId, boothId, booth);
  const scouts = await env.DB.prepare(`SELECT bsa.scout_id AS scoutId, s.name, s.age_level AS ageLevel,
    bsa.attendance_start AS attendanceStart, bsa.attendance_end AS attendanceEnd,
    bsa.stayed_through_close AS stayedThroughClose
    FROM booth_scout_assignments bsa JOIN scouts s ON s.id = bsa.scout_id
    WHERE bsa.organization_id = ? AND bsa.booth_id = ? ORDER BY s.name COLLATE NOCASE`)
    .bind(authorization.access.organizationId, boothId).all<{ scoutId: number; name: string; ageLevel: string; attendanceStart: string; attendanceEnd: string; stayedThroughClose: number }>();
  return Response.json({
    scouts: scouts.results.map((scout) => ({
      ...scout,
      stayedThroughClose: Boolean(scout.stayedThroughClose),
      creditedBoxes: sumRational(calculated.allocations.filter((item) => item.scoutId === Number(scout.scoutId))).value,
    })),
    totalBoxes: calculated.lines.reduce((sum, line) => sum + line.quantity, 0),
    allocatedBoxes: sumRational(calculated.allocations).value,
    unallocatedSales: [...new Set(calculated.allocations.length || calculated.unallocatedTransactionIds.length ? calculated.unallocatedTransactionIds.map((transactionId) => calculated.lines.find((line) => line.transactionId === transactionId)?.saleId).filter(Boolean) : [])],
    integrityErrors: calculated.integrityErrors,
    balanced: calculated.unallocatedTransactionIds.length === 0 && calculated.integrityErrors.length === 0,
  });
}
