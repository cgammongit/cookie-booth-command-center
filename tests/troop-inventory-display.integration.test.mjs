import assert from "node:assert/strict";
import test from "node:test";

const storedBalance = {
  productId: 1,
  name: "Thin Mints",
  barcode: "thin-mints",
  active: 1,
  totalRemaining: 91,
  available: 79,
  removed: 9,
};

const storedMovements = [
  {
    id: 1,
    productId: 1,
    productName: "Thin Mints",
    boothId: 100,
    boothName: "Existing reconciliation booth",
    type: "booth_return",
    totalDelta: 0,
    availableDelta: 12,
    boothDelta: -12,
    reason: "Unsold inventory returned during booth reconciliation",
    reference: "reconciliation:50",
    createdAt: "2026-07-28T12:00:00.000Z",
    actorName: "Inventory Admin",
  },
];

globalThis.__CLERK_TEST_AUTH__ = { userId: "clerk-troop-admin" };
globalThis.__CLERK_TEST_CLIENT__ = {};

function normalized(sql) {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

class TroopInventoryStatement {
  constructor(sql) {
    this.sql = sql;
    this.params = [];
  }

  bind(...params) {
    this.params = params;
    return this;
  }

  async raw() {
    const sql = normalized(this.sql);
    if (sql.includes('from "users" inner join "memberships"')) {
      if (
        Number(this.params[0]) !== 1 ||
        !this.params.includes("clerk-troop-admin")
      ) {
        return [];
      }
      return [[11, 21, 1, "admin", "active", false]];
    }
    throw new Error(`Unexpected authorization query: ${sql}`);
  }

  async all() {
    const sql = normalized(this.sql);
    if (sql.includes("from products p") && sql.includes("troop_inventory_balances")) {
      return { results: [{ ...storedBalance }] };
    }
    if (sql.includes("select l.id") && sql.includes("from inventory_ledger l")) {
      return {
        results: storedMovements.map((movement) => ({ ...movement })),
      };
    }
    if (sql.includes("from inventory i") && sql.includes("join booths b")) {
      return { results: [] };
    }
    throw new Error(`Unexpected troop inventory query: ${sql}`);
  }
}

globalThis.__CLOUDFLARE_ENV__ = {
  DB: {
    prepare(sql) {
      return new TroopInventoryStatement(sql);
    },
  },
};

const route = await import("../app/api/admin/troop-inventory/route.ts");
const {
  formatInventoryMovementDisplayQuantity,
  getInventoryMovementDisplayQuantity,
} = await import("../lib/inventory-movement-display.ts");

function movement(type, totalDelta, availableDelta) {
  return { type, totalDelta, availableDelta };
}

test("booth transfers display their available-stock quantity and sign", () => {
  assert.equal(
    getInventoryMovementDisplayQuantity(
      movement("booth_allocation", 0, -14),
    ),
    -14,
  );
  assert.equal(
    formatInventoryMovementDisplayQuantity(
      movement("booth_allocation", 0, -14),
    ),
    "-14",
  );
  assert.equal(
    getInventoryMovementDisplayQuantity(movement("booth_return", 0, 9)),
    9,
  );
  assert.equal(
    formatInventoryMovementDisplayQuantity(movement("booth_return", 0, 9)),
    "+9",
  );
  assert.equal(
    formatInventoryMovementDisplayQuantity(movement("booth_return", 25, 0)),
    "0",
    "zero remains visible when the relevant available dimension is zero",
  );
});

test("troop-total movements retain total-delta signs", () => {
  const cases = [
    ["initial_order", 100, "+100"],
    ["replenishment", 40, "+40"],
    ["trade_in", 8, "+8"],
    ["trade_out", -7, "-7"],
    ["council_return", -6, "-6"],
    ["damage", -5, "-5"],
    ["loss", -4, "-4"],
    ["correction_in", 3, "+3"],
    ["correction_out", -2, "-2"],
    ["booth_sale", -9, "-9"],
    ["legacy_migration", 12, "+12"],
  ];
  for (const [type, totalDelta, expected] of cases) {
    assert.equal(
      formatInventoryMovementDisplayQuantity(
        movement(type, totalDelta, totalDelta === 0 ? 0 : 999),
      ),
      expected,
      type,
    );
  }
});

test("previous reconciliation rows render correctly without mutation", () => {
  const existing = Object.freeze({ ...storedMovements[0] });
  const before = { ...existing };
  assert.equal(getInventoryMovementDisplayQuantity(existing), 12);
  assert.equal(formatInventoryMovementDisplayQuantity(existing), "+12");
  assert.deepEqual(existing, before);
});

test("Troop Inventory API returns authoritative balances and ledger dimensions unchanged", async () => {
  const response = await route.GET(
    new Request(
      "https://app.example/api/admin/troop-inventory?organizationId=1",
    ),
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.balances, [{
    ...storedBalance,
    atBooths: 0,
    boothBreakdown: [],
  }]);
  assert.deepEqual(payload.movements, storedMovements);
  assert.equal(payload.movements[0].totalDelta, 0);
  assert.equal(payload.movements[0].availableDelta, 12);
  assert.equal(payload.movements[0].boothDelta, -12);
});
