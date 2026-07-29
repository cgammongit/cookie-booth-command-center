import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireOrganizationPermission } from "../../../../lib/access";
import { broadcastBoothEvent } from "../../../../lib/booth-live";
import {
  buildInventorySnapshotGuard,
  createInventoryRevision,
  minimumSafeOpening,
  type InventorySnapshotItem,
} from "../../../../lib/inventory-allocation";

const querySchema = z.object({
  organizationId: z.coerce.number().int().positive(),
  boothId: z.coerce.number().int().positive(),
});

const saveSchema = z.object({
  organizationId: z.number().int().positive(),
  boothId: z.number().int().positive(),
  expectedRevision: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  allocations: z.array(z.object({
    productId: z.number().int().positive(),
    opening: z.number().int().min(0).max(10000),
  }).strict()).max(250),
}).strict();

async function findBooth(organizationId: number, boothId: number) {
  return env.DB.prepare(`
    SELECT id, status, archived_at AS archivedAt
    FROM booths WHERE id = ? AND organization_id = ?
  `).bind(boothId, organizationId).first<{
    id: number;
    status: string;
    archivedAt: string | null;
  }>();
}

async function readInventorySnapshot(boothId: number) {
  const result = await env.DB.prepare(`
    SELECT product_id AS productId, opening, sold, adjusted
    FROM inventory WHERE booth_id = ? ORDER BY product_id
  `).bind(boothId).all<InventorySnapshotItem>();
  return result.results.map((item) => ({
    productId: Number(item.productId),
    opening: Number(item.opening),
    sold: Number(item.sold),
    adjusted: Number(item.adjusted),
  }));
}

async function readActiveProductIds(organizationId: number) {
  const result = await env.DB.prepare(`
    SELECT id FROM products
    WHERE organization_id = ? AND active = 1
  `).bind(organizationId).all<{ id: number }>();
  return new Set(result.results.map((item) => Number(item.id)));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    organizationId: url.searchParams.get("organizationId"),
    boothId: url.searchParams.get("boothId"),
  });
  if (!parsed.success) {
    return Response.json({ error: "Valid organization and booth are required" }, { status: 400 });
  }
  const authorization = await requireOrganizationPermission(
    parsed.data.organizationId,
    "inventory.manage",
  );
  if (authorization.error) return authorization.error;
  const booth = await findBooth(parsed.data.organizationId, parsed.data.boothId);
  if (!booth) return Response.json({ error: "Booth not found" }, { status: 404 });

  const snapshot = await readInventorySnapshot(parsed.data.boothId);
  const result = await env.DB.prepare(`
    SELECT p.id, p.name, p.barcode, p.price, p.active,
      CASE WHEN i.id IS NULL THEN 0 ELSE 1 END AS configured,
      CASE
        WHEN i.opening = 0 AND i.sold = 0 AND i.adjusted = 0 THEN NULL
        ELSE i.opening
      END AS opening,
      i.sold, i.adjusted,
      COALESCE(tb.available, 0) AS troopAvailable
    FROM products p
    LEFT JOIN inventory i ON i.product_id = p.id AND i.booth_id = ?
    LEFT JOIN troop_inventory_balances tb
      ON tb.product_id = p.id AND tb.organization_id = p.organization_id
    WHERE p.organization_id = ?
    ORDER BY p.active DESC, p.name
  `).bind(parsed.data.boothId, parsed.data.organizationId).all();
  return Response.json({
    inventory: result.results,
    editable: !booth.archivedAt && booth.status !== "closed",
    revision: await createInventoryRevision(snapshot, booth),
  });
}

export async function PUT(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = saveSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message || "Invalid inventory configuration" },
      { status: 400 },
    );
  }
  const authorization = await requireOrganizationPermission(
    parsed.data.organizationId,
    "inventory.manage",
  );
  if (authorization.error) return authorization.error;
  const booth = await findBooth(parsed.data.organizationId, parsed.data.boothId);
  if (!booth) return Response.json({ error: "Booth not found" }, { status: 404 });
  if (booth.archivedAt || booth.status === "closed") {
    return Response.json(
      { error: "Archived and closed booth inventory cannot be reconfigured" },
      { status: 409 },
    );
  }
  if (!parsed.data.expectedRevision) {
    return Response.json(
      { error: "Refresh booth inventory before saving changes" },
      { status: 428 },
    );
  }

  const productIds = [...new Set(parsed.data.allocations.map((item) => item.productId))];
  if (productIds.length !== parsed.data.allocations.length) {
    return Response.json({ error: "Each product may be allocated only once" }, { status: 400 });
  }
  const activeProductIds = await readActiveProductIds(parsed.data.organizationId);
  if (productIds.some((productId) => !activeProductIds.has(productId))) {
    return Response.json(
      { error: "One or more selected products are inactive or outside this organization" },
      { status: 400 },
    );
  }

  const existing = await readInventorySnapshot(parsed.data.boothId);
  const currentRevision = await createInventoryRevision(existing, booth);
  if (parsed.data.expectedRevision !== currentRevision) {
    return Response.json(
      {
        error: "Booth inventory changed in another session. Review the latest quantities and try again.",
        code: "inventory_conflict",
      },
      { status: 409 },
    );
  }

  const requested = new Map(parsed.data.allocations.map((item) => [item.productId, item.opening]));
  const omittedActive = existing.filter(
    (item) =>
      activeProductIds.has(item.productId) &&
      !requested.has(item.productId),
  );
  const invalidMinimum = existing.find((item) => {
    const opening = requested.get(item.productId);
    return (
      (opening !== undefined && opening < minimumSafeOpening(item)) ||
      (opening === undefined &&
        activeProductIds.has(item.productId) &&
        minimumSafeOpening(item) > 0)
    );
  });
  if (invalidMinimum) {
    const minimum = minimumSafeOpening(invalidMinimum);
    return Response.json(
      {
        error: `Allocation must be at least ${minimum} to cover recorded booth activity.`,
        code: "negative_inventory",
        productId: invalidMinimum.productId,
        minimum,
      },
      { status: 422 },
    );
  }
  if (omittedActive.length) {
    return Response.json(
      {
        error: "Existing allocations must be sent explicitly. Use zero to deallocate a product.",
        code: "allocation_intent_required",
      },
      { status: 400 },
    );
  }

  const currentByProduct = new Map(existing.map((item) => [item.productId, Number(item.opening)]));
  const changes = parsed.data.allocations
    .map((item) => ({
      productId: item.productId,
      delta: item.opening - (currentByProduct.get(item.productId) || 0),
    }))
    .filter((item) => item.delta !== 0);
  if (!changes.length) {
    return Response.json({ saved: true, revision: currentRevision });
  }

  const changedProductIds = new Set(changes.map((item) => item.productId));
  const changedAllocations = parsed.data.allocations.filter((item) =>
    changedProductIds.has(item.productId)
  );
  const after = new Map(existing.map((item) => [item.productId, { ...item }]));
  for (const item of changedAllocations) {
    const current = after.get(item.productId);
    after.set(item.productId, {
      productId: item.productId,
      opening: item.opening,
      sold: current?.sold || 0,
      adjusted: current?.adjusted || 0,
    });
  }
  const afterSnapshot = [...after.values()].sort(
    (left, right) => left.productId - right.productId,
  );
  const guard = buildInventorySnapshotGuard(
    parsed.data.boothId,
    parsed.data.organizationId,
    existing,
  );
  const now = new Date().toISOString();
  const statements = [
    ...changes.map((item) =>
      env.DB.prepare(`
        UPDATE troop_inventory_balances
        SET available = available + ?, updated_at = ?
        WHERE organization_id = ? AND product_id = ?
          AND ${guard.sql}
      `).bind(
        -item.delta,
        now,
        parsed.data.organizationId,
        item.productId,
        ...guard.params,
      ),
    ),
    ...changes.map((item) =>
      env.DB.prepare(`
        INSERT INTO inventory_ledger (
          organization_id, product_id, booth_id, actor_user_id, movement_type,
          total_delta, available_delta, booth_delta, reason, created_at
        )
        SELECT ?, ?, ?, ?, ?, 0, ?, ?, ?, ?
        WHERE ${guard.sql}
      `).bind(
        parsed.data.organizationId,
        item.productId,
        parsed.data.boothId,
        authorization.access.userId,
        item.delta > 0 ? "booth_allocation" : "booth_return",
        -item.delta,
        item.delta,
        item.delta > 0
          ? "Opening inventory allocated to booth"
          : "Opening inventory returned to available troop stock",
        now,
        ...guard.params,
      ),
    ),
    env.DB.prepare(`
      INSERT INTO inventory_configuration_audit (
        organization_id, booth_id, actor_user_id, before_json, after_json, created_at
      )
      SELECT ?, ?, ?, ?, ?, ?
      WHERE ${guard.sql}
    `).bind(
      parsed.data.organizationId,
      parsed.data.boothId,
      authorization.access.userId,
      JSON.stringify(existing),
      JSON.stringify(afterSnapshot),
      now,
      ...guard.params,
    ),
    env.DB.prepare(`
      INSERT INTO inventory (booth_id, product_id, opening, sold, adjusted)
      ${changedAllocations.map(() => `SELECT ?, ?, ?, 0, 0 WHERE ${guard.sql}`).join("\nUNION ALL\n")}
      ON CONFLICT (booth_id, product_id)
      DO UPDATE SET opening = excluded.opening
    `).bind(
      ...changedAllocations.flatMap((item) => [
        parsed.data.boothId,
        item.productId,
        item.opening,
        ...guard.params,
      ]),
    ),
  ];
  try {
    const results = await env.DB.batch(statements);
    const inventoryResult = results.at(-1);
    if (Number(inventoryResult?.meta?.changes || 0) !== changedAllocations.length) {
      return Response.json(
        {
          error: "Booth inventory changed in another session. Review the latest quantities and try again.",
          code: "inventory_conflict",
        },
        { status: 409 },
      );
    }
  } catch (error) {
    if (String(error).toLowerCase().includes("check constraint")) {
      return Response.json(
        { error: "This allocation exceeds the troop inventory available for one or more products" },
        { status: 409 },
      );
    }
    throw error;
  }
  await broadcastBoothEvent(
    parsed.data.organizationId,
    parsed.data.boothId,
    ["inventory"],
  ).catch(() => undefined);
  const savedSnapshot = await readInventorySnapshot(parsed.data.boothId);
  return Response.json({
    saved: true,
    revision: await createInventoryRevision(savedSnapshot, booth),
  });
}
