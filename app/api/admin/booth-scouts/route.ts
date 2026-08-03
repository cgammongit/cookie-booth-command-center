import { env } from "cloudflare:workers";
import { z } from "zod";
import { getOrganizationAccess } from "../../../../lib/access";
import { hasOrganizationPermission } from "../../../../lib/organization-permissions";
import { isValidAttendance } from "../../../../lib/scout-credit";
import { broadcastBoothEvent } from "../../../../lib/booth-live";

const querySchema = z.object({ organizationId: z.coerce.number().int().positive(), boothId: z.coerce.number().int().positive() });
const assignmentSchema = z.object({ scoutId: z.number().int().positive(), attendanceStart: z.string().datetime(), attendanceEnd: z.string().datetime() }).strict();
const updateSchema = z.object({ organizationId: z.number().int().positive(), boothId: z.number().int().positive(), revision: z.string().max(100), assignments: z.array(assignmentSchema).max(100) }).strict();

function isScheduledTime(value: string, booth: { startsAt: string; endsAt: string }) {
  const time = Date.parse(value); const start = Date.parse(booth.startsAt); const end = Date.parse(booth.endsAt);
  return Number.isFinite(time) && time >= start && time <= end && (time === start || time === end || time % (15 * 60 * 1000) === 0);
}

async function authorize(organizationId: number, boothId: number) {
  const access = await getOrganizationAccess(organizationId);
  if (!access) return { error: Response.json({ error: "Access not assigned" }, { status: 403 }), booth: null, canEditTimes: false };
  const booth = await env.DB.prepare(`SELECT id, starts_at AS startsAt, ends_at AS endsAt, status, archived_at AS archivedAt, scout_assignment_revision AS revision FROM booths WHERE id = ? AND organization_id = ?`)
    .bind(boothId, organizationId).first<{ id: number; startsAt: string; endsAt: string; status: string; archivedAt: string | null; revision: string }>();
  if (!booth) return { error: Response.json({ error: "Booth not found" }, { status: 404 }), booth: null, canEditTimes: false };
  const canEditTimes = hasOrganizationPermission(access.role, "assignment.manage");
  if (!canEditTimes) {
    if (access.role !== "volunteer") return { error: Response.json({ error: "Scout roster access is required" }, { status: 403 }), booth: null, canEditTimes: false };
    const assignment = await env.DB.prepare("SELECT id FROM assignments WHERE booth_id = ? AND user_id = ? AND role = 'volunteer'").bind(boothId, access.userId).first();
    if (!assignment) return { error: Response.json({ error: "You may manage scouts only for an assigned booth" }, { status: 403 }), booth: null, canEditTimes: false };
  }
  return { error: null, booth, canEditTimes };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({ organizationId: url.searchParams.get("organizationId"), boothId: url.searchParams.get("boothId") });
  if (!parsed.success) return Response.json({ error: "A valid organization and booth are required" }, { status: 400 });
  const checked = await authorize(parsed.data.organizationId, parsed.data.boothId);
  if (checked.error) return checked.error;
  const [scouts, assignments] = await Promise.all([
    env.DB.prepare(`SELECT id, name, age_level AS ageLevel, archived_at AS archivedAt FROM scouts WHERE organization_id = ? AND (archived_at IS NULL OR id IN (SELECT scout_id FROM booth_scout_assignments WHERE booth_id = ? AND organization_id = ?)) ORDER BY archived_at IS NOT NULL, name COLLATE NOCASE`).bind(parsed.data.organizationId, parsed.data.boothId, parsed.data.organizationId).all(),
    env.DB.prepare(`SELECT bsa.id, bsa.scout_id AS scoutId, s.name, s.age_level AS ageLevel, s.archived_at AS archivedAt, bsa.attendance_start AS attendanceStart, bsa.attendance_end AS attendanceEnd, bsa.stayed_through_close AS stayedThroughClose FROM booth_scout_assignments bsa JOIN scouts s ON s.id = bsa.scout_id WHERE bsa.booth_id = ? AND bsa.organization_id = ? ORDER BY s.name COLLATE NOCASE`).bind(parsed.data.boothId, parsed.data.organizationId).all(),
  ]);
  return Response.json({ booth: checked.booth, scouts: scouts.results, assignments: assignments.results, permissions: { canManageRoster: true, canEditTimes: checked.canEditTimes } });
}

export async function PUT(request: Request) {
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Invalid scout assignments" }, { status: 400 });
  const checked = await authorize(parsed.data.organizationId, parsed.data.boothId);
  if (checked.error) return checked.error;
  const booth = checked.booth!;
  if (booth.archivedAt || booth.status === "closed") return Response.json({ error: "Scout attendance is locked after reconciliation or archival" }, { status: 409 });
  const ids = parsed.data.assignments.map((item) => item.scoutId);
  if (new Set(ids).size !== ids.length) return Response.json({ error: "A scout may be assigned only once per booth" }, { status: 400 });
  const current = await env.DB.prepare("SELECT scout_id AS scoutId, attendance_start AS attendanceStart, attendance_end AS attendanceEnd FROM booth_scout_assignments WHERE booth_id = ? AND organization_id = ?").bind(parsed.data.boothId, parsed.data.organizationId).all<{ scoutId: number; attendanceStart: string; attendanceEnd: string }>();
  const currentIds = new Set(current.results.map((item) => Number(item.scoutId)));
  const currentByScout = new Map(current.results.map((item) => [Number(item.scoutId), item]));
  if (!checked.canEditTimes && parsed.data.assignments.some((item) => {
    const existing = currentByScout.get(item.scoutId);
    return existing && (item.attendanceStart !== existing.attendanceStart || item.attendanceEnd !== existing.attendanceEnd);
  })) return Response.json({ error: "Assigned volunteers may select scouts but cannot edit attendance times" }, { status: 403 });
  const normalizedAssignments = parsed.data.assignments.map((item) => {
    if (checked.canEditTimes) return item;
    const existing = currentByScout.get(item.scoutId);
    return existing ? { scoutId: item.scoutId, attendanceStart: existing.attendanceStart, attendanceEnd: existing.attendanceEnd } : { scoutId: item.scoutId, attendanceStart: booth.startsAt, attendanceEnd: booth.endsAt };
  });
  if (normalizedAssignments.some((item) => {
    const existing = currentByScout.get(item.scoutId); const unchanged = existing?.attendanceStart === item.attendanceStart && existing?.attendanceEnd === item.attendanceEnd;
    return !isValidAttendance(item, booth) || (!unchanged && (!isScheduledTime(item.attendanceStart, booth) || !isScheduledTime(item.attendanceEnd, booth)));
  })) return Response.json({ error: "Attendance times must use the booth date and valid 15-minute options" }, { status: 400 });
  if (ids.length) {
    const placeholders = ids.map(() => "?").join(",");
    const valid = await env.DB.prepare(`SELECT id, archived_at AS archivedAt FROM scouts WHERE organization_id = ? AND id IN (${placeholders})`).bind(parsed.data.organizationId, ...ids).all<{ id: number; archivedAt: string | null }>();
    if (valid.results.length !== ids.length || valid.results.some((scout) => scout.archivedAt && !currentIds.has(Number(scout.id)))) return Response.json({ error: "Only active scouts in this organization may be newly assigned" }, { status: 403 });
  }
  const removed = [...currentIds].filter((id) => !ids.includes(id));
  if (removed.length) {
    const placeholders = removed.map(() => "?").join(",");
    const finalized = await env.DB.prepare(`SELECT id FROM scout_sales_credits WHERE booth_id = ? AND organization_id = ? AND scout_id IN (${placeholders}) LIMIT 1`).bind(parsed.data.boothId, parsed.data.organizationId, ...removed).first();
    if (finalized) return Response.json({ error: "A scout with finalized sales credit cannot be removed" }, { status: 409 });
  }
  const now = new Date().toISOString();
  const nextRevision = crypto.randomUUID();
  const statements = [
    env.DB.prepare("UPDATE booths SET scout_assignment_revision = ? WHERE id = ? AND organization_id = ? AND scout_assignment_revision = ? AND status <> 'closed' AND archived_at IS NULL").bind(nextRevision, parsed.data.boothId, parsed.data.organizationId, parsed.data.revision),
    env.DB.prepare("DELETE FROM booth_scout_assignments WHERE booth_id = ? AND organization_id = ? AND EXISTS (SELECT 1 FROM booths WHERE id = ? AND scout_assignment_revision = ?)").bind(parsed.data.boothId, parsed.data.organizationId, parsed.data.boothId, nextRevision),
  ];
  for (const item of normalizedAssignments) statements.push(env.DB.prepare(`INSERT INTO booth_scout_assignments (organization_id, booth_id, scout_id, attendance_start, attendance_end, stayed_through_close, created_at, updated_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM booths WHERE id = ? AND scout_assignment_revision = ?)`)
    .bind(parsed.data.organizationId, parsed.data.boothId, item.scoutId, item.attendanceStart, item.attendanceEnd, item.attendanceEnd === booth.endsAt ? 1 : 0, now, now, parsed.data.boothId, nextRevision));
  try {
    const results = await env.DB.batch(statements);
    if (Number(results[0]?.meta?.changes || 0) !== 1) return Response.json({ error: "Scout attendance changed. Refresh and try again.", code: "attendance_conflict" }, { status: 409 });
  } catch { return Response.json({ error: "Scout attendance changed. Refresh and try again.", code: "attendance_conflict" }, { status: 409 }); }
  await broadcastBoothEvent(parsed.data.organizationId, parsed.data.boothId, ["attendance"]).catch(() => undefined);
  return Response.json({ updated: true, revision: nextRevision });
}
