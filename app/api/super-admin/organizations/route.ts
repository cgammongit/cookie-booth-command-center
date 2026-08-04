import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireSuperAdmin } from "../../../../lib/super-admin";

const purgeSchema = z.object({
  organizationId: z.number().int().positive(),
  confirmationName: z.string().trim().min(1).max(200),
  acknowledged: z.literal(true),
  reason: z.string().trim().max(500).optional().default(""),
}).strict();

type OrganizationSummary = {
  id: number;
  name: string;
  memberCount: number;
  productCount: number;
  boothCount: number;
  inventoryTransactionCount: number;
  salesCount: number;
  auditCount: number;
  scoutCount: number;
  scoutCreditCount: number;
  latestActivityAt: string | null;
};

const summarySql = `
  SELECT o.id, o.name,
    (SELECT COUNT(*) FROM memberships m WHERE m.organization_id = o.id) AS memberCount,
    (SELECT COUNT(*) FROM products p WHERE p.organization_id = o.id) AS productCount,
    (SELECT COUNT(*) FROM booths b WHERE b.organization_id = o.id) AS boothCount,
    (SELECT COUNT(*) FROM scouts sc WHERE sc.organization_id = o.id) AS scoutCount,
    (SELECT COUNT(*) FROM scout_sales_credits c WHERE c.organization_id = o.id) AS scoutCreditCount,
    (SELECT COUNT(*) FROM inventory_ledger l WHERE l.organization_id = o.id) AS inventoryTransactionCount,
    (SELECT COUNT(*) FROM sales s JOIN booths b ON b.id = s.booth_id WHERE b.organization_id = o.id) AS salesCount,
    (
      (SELECT COUNT(*) FROM access_audit_log a WHERE a.organization_id = o.id) +
      (SELECT COUNT(*) FROM booth_lifecycle_audit a WHERE a.organization_id = o.id) +
      (SELECT COUNT(*) FROM inventory_configuration_audit a WHERE a.organization_id = o.id) +
      (SELECT COUNT(*) FROM product_catalog_audit a WHERE a.organization_id = o.id)
    ) AS auditCount,
    (
      SELECT MAX(activity_at) FROM (
        SELECT MAX(created_at) AS activity_at FROM inventory_ledger WHERE organization_id = o.id
        UNION ALL
        SELECT MAX(s.created_at) FROM sales s JOIN booths b ON b.id = s.booth_id WHERE b.organization_id = o.id
        UNION ALL
        SELECT MAX(created_at) FROM access_audit_log WHERE organization_id = o.id
      )
    ) AS latestActivityAt
  FROM organizations o
`;

export async function GET() {
  const authorization = await requireSuperAdmin();
  if (authorization.error) return authorization.error;

  const [organizations, audit] = await Promise.all([
    env.DB.prepare(`${summarySql} ORDER BY o.name, o.id`).all<OrganizationSummary>(),
    env.DB.prepare(`
      SELECT id, actor_display_name AS actorDisplayName, action,
        target_organization_id AS targetOrganizationId,
        target_organization_name AS targetOrganizationName,
        reason, deleted_counts_json AS deletedCountsJson,
        outcome, request_id AS requestId, created_at AS createdAt
      FROM super_admin_audit_log
      ORDER BY id DESC
      LIMIT 100
    `).all(),
  ]);

  return Response.json({ organizations: organizations.results, audit: audit.results });
}

export async function POST(request: Request) {
  const authorization = await requireSuperAdmin();
  if (authorization.error || !authorization.clerkUserId) return authorization.error;

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = purgeSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "Complete every purge confirmation field" }, { status: 400 });
  }

  const organization = await env.DB.prepare(
    `${summarySql} WHERE o.id = ?`,
  ).bind(parsed.data.organizationId).first<OrganizationSummary>();
  if (!organization) {
    return Response.json({ error: "Organization not found" }, { status: 404 });
  }
  if (parsed.data.confirmationName !== organization.name) {
    return Response.json({ error: "The organization name does not match" }, { status: 400 });
  }

  const actor = await env.DB.prepare(`
    SELECT id, display_name AS displayName
    FROM users
    WHERE clerk_user_id = ?
    LIMIT 1
  `).bind(authorization.clerkUserId).first<{ id: number; displayName: string }>();
  const requestId = crypto.randomUUID();
  const now = new Date().toISOString();
  const counts = {
    booths: Number(organization.boothCount),
    inventoryTransactions: Number(organization.inventoryTransactionCount),
    sales: Number(organization.salesCount),
    regularAuditEvents: Number(organization.auditCount),
    scouts: Number(organization.scoutCount),
    scoutCredits: Number(organization.scoutCreditCount),
  };
  const organizationId = organization.id;

  const boothScoped = (sql: string) => env.DB.prepare(sql).bind(organizationId);
  try {
    await env.DB.batch([
      boothScoped("DELETE FROM scout_sales_credits WHERE organization_id = ?"),
      boothScoped("DELETE FROM sale_reversals WHERE organization_id = ?"),
      boothScoped(`DELETE FROM reconciliation_items WHERE reconciliation_id IN (
        SELECT r.id FROM reconciliations r JOIN booths b ON b.id = r.booth_id
        WHERE b.organization_id = ?
      )`),
      boothScoped(`DELETE FROM reconciliations WHERE booth_id IN (
        SELECT id FROM booths WHERE organization_id = ?
      )`),
      boothScoped(`DELETE FROM transactions WHERE booth_id IN (
        SELECT id FROM booths WHERE organization_id = ?
      )`),
      boothScoped(`DELETE FROM sales WHERE booth_id IN (
        SELECT id FROM booths WHERE organization_id = ?
      )`),
      boothScoped(`DELETE FROM inventory WHERE booth_id IN (
        SELECT id FROM booths WHERE organization_id = ?
      )`),
      boothScoped(`DELETE FROM assignments WHERE booth_id IN (
        SELECT id FROM booths WHERE organization_id = ?
      )`),
      boothScoped("DELETE FROM booth_scout_assignments WHERE organization_id = ?"),
      boothScoped("DELETE FROM admin_alerts WHERE organization_id = ?"),
      boothScoped("DELETE FROM booth_lifecycle_audit WHERE organization_id = ?"),
      boothScoped("DELETE FROM inventory_configuration_audit WHERE organization_id = ?"),
      boothScoped("DELETE FROM inventory_ledger WHERE organization_id = ?"),
      boothScoped("DELETE FROM troop_inventory_balances WHERE organization_id = ?"),
      boothScoped("DELETE FROM access_audit_log WHERE organization_id = ?"),
      boothScoped("DELETE FROM product_catalog_audit WHERE organization_id = ?"),
      boothScoped("DELETE FROM booths WHERE organization_id = ?"),
      boothScoped("DELETE FROM scouts WHERE organization_id = ?"),
      env.DB.prepare(`
        INSERT INTO super_admin_audit_log (
          actor_clerk_user_id, actor_user_id, actor_display_name, action,
          target_organization_id, target_organization_name, reason,
          deleted_counts_json, outcome, request_id, created_at
        ) VALUES (?, ?, ?, 'organization_data_purged', ?, ?, ?, ?, 'success', ?, ?)
      `).bind(
        authorization.clerkUserId,
        actor?.id || null,
        actor?.displayName || "Super Administrator",
        organizationId,
        organization.name,
        parsed.data.reason || null,
        JSON.stringify(counts),
        requestId,
        now,
      ),
    ]);
  } catch {
    try {
      await env.DB.prepare(`
        INSERT INTO super_admin_audit_log (
          actor_clerk_user_id, actor_user_id, actor_display_name, action,
          target_organization_id, target_organization_name, reason,
          deleted_counts_json, outcome, request_id, created_at
        ) VALUES (?, ?, ?, 'organization_data_purge_failed', ?, ?, ?, ?, 'failure', ?, ?)
      `).bind(
        authorization.clerkUserId,
        actor?.id || null,
        actor?.displayName || "Super Administrator",
        organizationId,
        organization.name,
        parsed.data.reason || null,
        JSON.stringify(counts),
        requestId,
        now,
      ).run();
    } catch {
      // The original purge error remains authoritative if audit persistence is unavailable.
    }
    return Response.json(
      { error: "The purge failed and operational data was not removed", requestId },
      { status: 500 },
    );
  }

  return Response.json({
    purged: true,
    organization: { id: organization.id, name: organization.name },
    deletedCounts: counts,
    requestId,
  });
}
