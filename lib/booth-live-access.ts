import {
  evaluateBoothPermission,
  type OrganizationRole,
} from "./authorization-policy";

type BoothLiveAccess = {
  organizationId: number;
  userId: number;
};

type BoothLiveAccessRow = {
  organizationId: number;
  userId: number;
  organizationRole: string;
  assignmentRole: string | null;
  status: string;
  archivedAt: string | null;
};

const ORGANIZATION_ROLES = new Set<OrganizationRole>([
  "admin",
  "lead",
  "volunteer",
  "auditor",
]);

export async function authorizeBoothLiveAccess(
  database: D1Database,
  clerkUserId: string,
  boothId: number,
): Promise<BoothLiveAccess | null> {
  const row = await database.prepare(`
    SELECT
      b.organization_id AS organizationId,
      u.id AS userId,
      m.role AS organizationRole,
      a.role AS assignmentRole,
      b.status AS status,
      b.archived_at AS archivedAt
    FROM booths b
    INNER JOIN memberships m
      ON m.organization_id = b.organization_id
      AND m.status = 'active'
    INNER JOIN users u
      ON u.id = m.user_id
      AND u.clerk_user_id = ?
      AND u.status = 'active'
    LEFT JOIN assignments a
      ON a.booth_id = b.id
      AND a.user_id = u.id
    WHERE b.id = ?
    LIMIT 1
  `).bind(clerkUserId, boothId).first<BoothLiveAccessRow>();

  if (
    !row ||
    !ORGANIZATION_ROLES.has(row.organizationRole as OrganizationRole)
  ) {
    return null;
  }

  const role = row.organizationRole as OrganizationRole;
  const permitted = evaluateBoothPermission(
    {
      organizationId: row.organizationId,
      boothOrganizationId: row.organizationId,
      organizationRole: role,
      assigned:
        role === "admin" || role === "auditor" || Boolean(row.assignmentRole),
      archived: Boolean(row.archivedAt),
      closed: row.status === "closed",
    },
    "view",
  );

  return permitted
    ? { organizationId: row.organizationId, userId: row.userId }
    : null;
}
