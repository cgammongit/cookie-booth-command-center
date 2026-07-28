import { env } from "cloudflare:workers";
import { z } from "zod";
import { getOrganizationAccess, requireOrganizationAdmin } from "../../../lib/access";
import { getEffectiveBoothStatus, type BoothLifecycleStatus } from "../../../lib/booth-status";

const querySchema = z.object({
  organizationId: z.coerce.number().int().positive(),
});

const createSchema = z
  .object({
    organizationId: z.number().int().positive(),
    name: z.string().trim().min(2).max(120),
    address: z.string().trim().min(2).max(240),
    locationName: z.string().trim().max(160).nullable().optional(),
    googlePlaceId: z.string().trim().max(240).nullable().optional(),
    latitude: z.number().min(-90).max(90).nullable().optional(),
    longitude: z.number().min(-180).max(180).nullable().optional(),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
  })
  .strict()
  .refine((value) => new Date(value.endsAt) > new Date(value.startsAt), {
    message: "The booth end time must be after its start time",
  });

type BoothRow = {
  id: number;
  name: string;
  address: string;
  locationName: string | null;
  googlePlaceId: string | null;
  latitude: number | null;
  longitude: number | null;
  startsAt: string;
  endsAt: string;
  status: BoothLifecycleStatus;
  boxes: number;
  revenue: number;
  low: number;
  lead: string | null;
};

export async function GET(request: Request) {
  const parsed = querySchema.safeParse({
    organizationId: new URL(request.url).searchParams.get("organizationId"),
  });
  if (!parsed.success) {
    return Response.json({ error: "A valid organization is required" }, { status: 400 });
  }

  const access = await getOrganizationAccess(parsed.data.organizationId);
  if (!access) {
    return Response.json({ error: "Access not assigned" }, { status: 403 });
  }

  const restricted = access.role === "lead" || access.role === "volunteer";
  const result = await env.DB.prepare(`
    SELECT
      b.id,
      b.name,
      b.address,
      b.location_name AS locationName,
      b.google_place_id AS googlePlaceId,
      b.latitude,
      b.longitude,
      b.starts_at AS startsAt,
      b.ends_at AS endsAt,
      b.status,
      COALESCE((
        SELECT SUM(CASE WHEN t.type = 'sale' THEN t.quantity ELSE 0 END)
        FROM transactions t WHERE t.booth_id = b.id
      ), 0) AS boxes,
      COALESCE((
        SELECT SUM(CASE WHEN t.type = 'sale' THEN t.amount ELSE 0 END)
        FROM transactions t WHERE t.booth_id = b.id
      ), 0) AS revenue,
      COALESCE((
        SELECT COUNT(*)
        FROM inventory i
        WHERE i.booth_id = b.id AND (i.opening + i.adjusted - i.sold) <= 8
      ), 0) AS low,
      (
        SELECT u.display_name
        FROM assignments a
        JOIN users u ON u.id = a.user_id
        WHERE a.booth_id = b.id AND a.role = 'lead'
        ORDER BY u.display_name
        LIMIT 1
      ) AS lead
    FROM booths b
    WHERE b.organization_id = ?
      AND b.archived_at IS NULL
      AND b.status <> 'closed'
      AND (? = 0 OR EXISTS (
        SELECT 1 FROM assignments own
        WHERE own.booth_id = b.id AND own.user_id = ?
      ))
    ORDER BY b.starts_at, b.name
  `)
    .bind(parsed.data.organizationId, restricted ? 1 : 0, access.userId)
    .all<BoothRow>();

  return Response.json({
    booths: result.results.map((booth) => ({
      ...booth,
      status: getEffectiveBoothStatus(booth),
    })),
    permissions: {
      canCreateBooths: access.role === "admin",
      canViewReports: access.role === "admin" || access.role === "auditor",
      assignmentRequired: restricted,
    },
  });
}

export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message || "Invalid booth details" },
      { status: 400 },
    );
  }

  const authorization = await requireOrganizationAdmin(parsed.data.organizationId);
  if (authorization.error) return authorization.error;

  const result = await env.DB.prepare(`
    INSERT INTO booths (
      organization_id, name, address, location_name, google_place_id,
      latitude, longitude, starts_at, ends_at, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled')
  `)
    .bind(
      parsed.data.organizationId,
      parsed.data.name,
      parsed.data.address,
      parsed.data.locationName || null,
      parsed.data.googlePlaceId || null,
      parsed.data.latitude ?? null,
      parsed.data.longitude ?? null,
      parsed.data.startsAt,
      parsed.data.endsAt,
    )
    .run();

  return Response.json({ boothId: result.meta.last_row_id }, { status: 201 });
}
