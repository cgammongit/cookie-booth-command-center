import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireOrganizationPermission } from "../../../../lib/access";
import { SCOUT_AGE_LEVELS } from "../../../../lib/scout-credit";

const querySchema = z.object({ organizationId: z.coerce.number().int().positive() });
const createSchema = z.object({
  organizationId: z.number().int().positive(),
  name: z.string().trim().min(2).max(120),
  ageLevel: z.enum(SCOUT_AGE_LEVELS),
}).strict();

export async function GET(request: Request) {
  const parsed = querySchema.safeParse({
    organizationId: new URL(request.url).searchParams.get("organizationId"),
  });
  if (!parsed.success) return Response.json({ error: "A valid organization is required" }, { status: 400 });
  const authorization = await requireOrganizationPermission(parsed.data.organizationId, "people.manage");
  if (authorization.error) return authorization.error;
  const result = await env.DB.prepare(`
    SELECT id, name, age_level AS ageLevel, archived_at AS archivedAt,
      created_at AS createdAt, updated_at AS updatedAt
    FROM scouts WHERE organization_id = ?
    ORDER BY archived_at IS NOT NULL, name COLLATE NOCASE, id
  `).bind(parsed.data.organizationId).all();
  return Response.json({ scouts: result.results });
}

export async function POST(request: Request) {
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Invalid scout" }, { status: 400 });
  const authorization = await requireOrganizationPermission(parsed.data.organizationId, "people.manage");
  if (authorization.error) return authorization.error;
  const now = new Date().toISOString();
  try {
    const result = await env.DB.prepare(`
      INSERT INTO scouts (organization_id, name, age_level, archived_at, created_at, updated_at)
      VALUES (?, ?, ?, NULL, ?, ?)
    `).bind(parsed.data.organizationId, parsed.data.name, parsed.data.ageLevel, now, now).run();
    return Response.json({ scoutId: result.meta.last_row_id }, { status: 201 });
  } catch (error) {
    if (String(error).toLowerCase().includes("unique")) {
      return Response.json({ error: "A scout with that name already exists" }, { status: 409 });
    }
    throw error;
  }
}
