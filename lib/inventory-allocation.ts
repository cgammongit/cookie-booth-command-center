export type InventorySnapshotItem = {
  productId: number;
  opening: number;
  sold: number;
  adjusted: number;
};

export function minimumSafeOpening({
  sold,
  adjusted,
}: Pick<InventorySnapshotItem, "sold" | "adjusted">) {
  return Math.max(0, Number(sold) - Number(adjusted));
}

export function remainingInventory({
  opening,
  sold,
  adjusted,
}: InventorySnapshotItem) {
  return Number(opening) + Number(adjusted) - Number(sold);
}

export function validateAllocationDraft({
  opening,
  sold,
  adjusted,
}: {
  opening: number | null;
  sold: number;
  adjusted: number;
}) {
  const minimum = minimumSafeOpening({ sold, adjusted });
  const normalizedOpening = opening === null ? 0 : Number(opening);
  return {
    minimum,
    invalid: normalizedOpening < minimum,
  };
}

export function normalizeAllocationSubmission<
  Item extends {
    id: number;
    active: number;
    opening: number | null;
    configured?: number;
  },
>(items: Item[], baseline: Item[]) {
  const allocatedProductIds = new Set(
    baseline
      .filter((item) => Boolean(item.configured) || item.opening !== null)
      .map((item) => item.id),
  );
  return items
    .filter(
      (item) =>
        Boolean(item.active) &&
        (item.opening !== null || allocatedProductIds.has(item.id)),
    )
    .map((item) => ({
      productId: item.id,
      opening: Number(item.opening ?? 0),
    }));
}

export function mergeUnrelatedAllocationDrafts<
  Item extends {
    id: number;
    opening: number | null;
    sold: number | null;
    adjusted: number | null;
  },
>(latest: Item[], baseline: Item[], drafts: Item[]) {
  const baselineByProduct = new Map(baseline.map((item) => [item.id, item]));
  const draftByProduct = new Map(drafts.map((item) => [item.id, item]));
  return latest.map((item) => {
    const baselineItem = baselineByProduct.get(item.id);
    const draftItem = draftByProduct.get(item.id);
    const locallyChanged =
      Boolean(baselineItem && draftItem) &&
      draftItem!.opening !== baselineItem!.opening;
    const remotelyChanged =
      !baselineItem ||
      item.opening !== baselineItem.opening ||
      item.sold !== baselineItem.sold ||
      item.adjusted !== baselineItem.adjusted;
    return locallyChanged && !remotelyChanged
      ? { ...item, opening: draftItem!.opening }
      : item;
  });
}

export async function createInventoryRevision(
  items: InventorySnapshotItem[],
  lifecycle: { status: string; archivedAt: string | null },
) {
  const snapshot = JSON.stringify({
    lifecycle: {
      status: lifecycle.status,
      archivedAt: lifecycle.archivedAt,
    },
    items: [...items]
      .map((item) => ({
        productId: Number(item.productId),
        opening: Number(item.opening),
        sold: Number(item.sold),
        adjusted: Number(item.adjusted),
      }))
      .sort((left, right) => left.productId - right.productId),
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(snapshot),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

export function buildInventorySnapshotGuard(
  boothId: number,
  organizationId: number,
  items: InventorySnapshotItem[],
) {
  const canonicalItems = [...items]
    .map((item) => [
      Number(item.productId),
      Number(item.opening),
      Number(item.sold),
      Number(item.adjusted),
    ])
    .sort((left, right) => left[0] - right[0]);
  const lifecycleSql = `
    EXISTS (
      SELECT 1 FROM booths
      WHERE id = ? AND organization_id = ?
        AND archived_at IS NULL AND status <> 'closed'
    )
  `;
  const lifecycleParams: Array<string | number> = [boothId, organizationId];
  return {
    sql: `${lifecycleSql}
      AND COALESCE((
        SELECT json_group_array(json_array(product_id, opening, sold, adjusted))
        FROM (
          SELECT product_id, opening, sold, adjusted
          FROM inventory WHERE booth_id = ? ORDER BY product_id
        )
      ), '[]') = ?`,
    params: [
      ...lifecycleParams,
      boothId,
      JSON.stringify(canonicalItems),
    ],
  };
}
