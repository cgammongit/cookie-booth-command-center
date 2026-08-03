export const SCOUT_AGE_LEVELS = [
  "Daisy", "Brownie", "Junior", "Cadette", "Senior", "Ambassador",
] as const;

export type ScoutAgeLevel = (typeof SCOUT_AGE_LEVELS)[number];

export type ScoutAttendance = {
  scoutId: number;
  attendanceStart: string;
  attendanceEnd: string;
  stayedThroughClose: boolean;
};

export type CreditSaleLine = {
  saleId: string;
  transactionId: string;
  productId: number;
  quantity: number;
  createdAt: string;
};

export type CreditAllocation = CreditSaleLine & {
  scoutId: number;
  numerator: number;
  denominator: number;
};

export function isValidAttendance(
  assignment: Pick<ScoutAttendance, "attendanceStart" | "attendanceEnd">,
  booth: { startsAt: string; endsAt: string },
) {
  const start = Date.parse(assignment.attendanceStart);
  const end = Date.parse(assignment.attendanceEnd);
  const boothStart = Date.parse(booth.startsAt);
  const boothEnd = Date.parse(booth.endsAt);
  return [start, end, boothStart, boothEnd].every(Number.isFinite) &&
    start < end && start < boothEnd && end > boothStart;
}

export function eligibleScouts(
  saleAt: string,
  boothEndsAt: string,
  assignments: readonly ScoutAttendance[],
) {
  const saleTime = Date.parse(saleAt);
  const boothEnd = Date.parse(boothEndsAt);
  if (!Number.isFinite(saleTime) || !Number.isFinite(boothEnd)) return [];
  if (saleTime >= boothEnd) {
    return assignments.filter((assignment) => assignment.stayedThroughClose);
  }
  return assignments.filter((assignment) =>
    Date.parse(assignment.attendanceStart) <= saleTime &&
    saleTime < Date.parse(assignment.attendanceEnd));
}

export function allocateScoutCredits(
  lines: readonly CreditSaleLine[],
  boothEndsAt: string,
  assignments: readonly ScoutAttendance[],
) {
  const allocations: CreditAllocation[] = [];
  const unallocatedTransactionIds: string[] = [];
  for (const line of lines) {
    const eligible = eligibleScouts(line.createdAt, boothEndsAt, assignments);
    if (!eligible.length) {
      unallocatedTransactionIds.push(line.transactionId);
      continue;
    }
    for (const assignment of eligible) {
      allocations.push({
        ...line,
        scoutId: assignment.scoutId,
        numerator: line.quantity,
        denominator: eligible.length,
      });
    }
  }
  return { allocations, unallocatedTransactionIds };
}

function gcd(left: bigint, right: bigint): bigint {
  let a = left < BigInt(0) ? -left : left;
  let b = right < BigInt(0) ? -right : right;
  while (b) [a, b] = [b, a % b];
  return a || BigInt(1);
}

export function sumRational(values: readonly { numerator: number; denominator: number }[]) {
  let numerator = BigInt(0);
  let denominator = BigInt(1);
  for (const value of values) {
    numerator = numerator * BigInt(value.denominator) + BigInt(value.numerator) * denominator;
    denominator *= BigInt(value.denominator);
    const divisor = gcd(numerator, denominator);
    numerator /= divisor;
    denominator /= divisor;
  }
  return { numerator, denominator, value: Number(numerator) / Number(denominator) };
}

type D1Like = { prepare(query: string): { bind(...values: unknown[]): { all<T>(): Promise<{ results: T[] }> } } };

export async function calculateBoothScoutCredit(db: D1Like, organizationId: number, boothId: number, booth: { startsAt: string; endsAt: string }) {
  const [assignmentRows, lineRows] = await Promise.all([
    db.prepare(`SELECT scout_id AS scoutId, attendance_start AS attendanceStart,
      attendance_end AS attendanceEnd, stayed_through_close AS stayedThroughClose
      FROM booth_scout_assignments WHERE organization_id = ? AND booth_id = ?
      ORDER BY scout_id`).bind(organizationId, boothId).all<ScoutAttendance & { stayedThroughClose: number | boolean }>(),
    db.prepare(`SELECT s.id AS saleId, t.id AS transactionId, t.product_id AS productId,
      t.quantity, s.created_at AS createdAt
      FROM sales s JOIN transactions t ON t.sale_id = s.id
      WHERE s.booth_id = ? AND t.type = 'sale' ORDER BY s.created_at, t.id`)
      .bind(boothId).all<CreditSaleLine>(),
  ]);
  const assignments = assignmentRows.results.map((item) => ({ ...item, scoutId: Number(item.scoutId), stayedThroughClose: Boolean(item.stayedThroughClose) }));
  const lines = lineRows.results.map((item) => ({ ...item, productId: Number(item.productId), quantity: Number(item.quantity) }));
  const integrityErrors = assignments.filter((assignment) => !isValidAttendance(assignment, booth)).map((assignment) => assignment.scoutId);
  return { assignments, lines, integrityErrors, ...allocateScoutCredits(lines, booth.endsAt, assignments) };
}
