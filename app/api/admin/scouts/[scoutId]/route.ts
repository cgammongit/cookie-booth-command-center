import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireOrganizationPermission } from "../../../../../lib/access";
import { SCOUT_AGE_LEVELS } from "../../../../../lib/scout-credit";

const updateSchema = z.object({
  organizationId: z.number().int().positive(),
  name: z.string().trim().min(2).max(120),
  ageLevel: z.enum(SCOUT_AGE_LEVELS),
  archived: z.boolean(),
}).strict();

export async function PATCH(request: Request, context: { params: Promise<{ scoutId: string }> }) {
  const scoutId = Number((await context.params).scoutId);
  if (!Number.isInteger(scoutId) || scoutId < 1) return Response.json({ error: "Invalid scout" }, { status: 400 });
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Invalid scout" }, { status: 400 });
  const authorization = await requireOrganizationPermission(parsed.data.organizationId, "people.manage");
  if (authorization.error) return authorization.error;
  const existing = await env.DB.prepare("SELECT id, archived_at AS archivedAt FROM scouts WHERE id = ? AND organization_id = ?")
    .bind(scoutId, parsed.data.organizationId).first<{ id: number; archivedAt: string | null }>();
  if (!existing) return Response.json({ error: "Scout not found" }, { status: 404 });
  const now = new Date().toISOString();
  try {
    await env.DB.prepare(`UPDATE scouts SET name = ?, age_level = ?, archived_at = ?, updated_at = ? WHERE id = ? AND organization_id = ?`)
      .bind(parsed.data.name, parsed.data.ageLevel, parsed.data.archived ? (existing.archivedAt || now) : null, now, scoutId, parsed.data.organizationId).run();
    return Response.json({ updated: true });
  } catch (error) {
    if (String(error).toLowerCase().includes("unique")) return Response.json({ error: "A scout with that name already exists" }, { status: 409 });
    throw error;
  }
}
