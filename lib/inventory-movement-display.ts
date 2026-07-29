export type InventoryMovementDisplayFields = {
  type: string;
  totalDelta: number;
  availableDelta: number;
};

const availableInventoryMovements = new Set([
  "booth_allocation",
  "booth_return",
]);

export function getInventoryMovementDisplayQuantity(
  movement: InventoryMovementDisplayFields,
) {
  return Number(
    availableInventoryMovements.has(movement.type)
      ? movement.availableDelta
      : movement.totalDelta,
  );
}

export function formatInventoryMovementDisplayQuantity(
  movement: InventoryMovementDisplayFields,
) {
  const quantity = getInventoryMovementDisplayQuantity(movement);
  return `${quantity > 0 ? "+" : ""}${quantity}`;
}
