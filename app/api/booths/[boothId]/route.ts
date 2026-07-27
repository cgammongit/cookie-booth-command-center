import { env } from "cloudflare:workers";
import { requireBoothAccess } from "../../../../lib/access";

export async function GET(
  _request: Request,
  context: { params: Promise<{ boothId: string }> },
) {
  const { boothId: rawBoothId } = await context.params;
  const boothId = Number(rawBoothId);
  if (!Number.isInteger(boothId) || boothId < 1) {
    return Response.json({ error: "Invalid booth" }, { status: 400 });
  }

  const authorization = await requireBoothAccess(boothId);
  if (authorization.error) return authorization.error;

  const booth = await env.DB.prepare(`
    SELECT id, organization_id AS organizationId, name, address,
      starts_at AS startsAt, ends_at AS endsAt, status
    FROM booths WHERE id = ?
  `).bind(boothId).first();

  return Response.json({
    booth,
    permissions: {
      canOperate: authorization.access.canOperate,
      canManage: authorization.access.canManage,
      canReconcile: authorization.access.canReconcile,
      canViewReports: authorization.access.canViewReports,
    },
  });
}
