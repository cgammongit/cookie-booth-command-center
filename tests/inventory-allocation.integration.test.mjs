import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const state = {
  actor: {
    clerkUserId: "clerk-inventory-admin",
    userId: 11,
    organizationId: 1,
    role: "admin",
  },
  booth: {
    id: 100,
    organizationId: 1,
    status: "live",
    archivedAt: null,
  },
  inventory: [
    { productId: 1, opening: 10, sold: 4, adjusted: 0 },
  ],
  troopAvailable: 90,
  ledger: [],
  audits: [],
  broadcasts: [],
  concurrentBeforeBatch: null,
};

globalThis.__CLERK_TEST_AUTH__ = { userId: state.actor.clerkUserId };
globalThis.__CLERK_TEST_CLIENT__ = {
  users: { getUser: async () => ({ twoFactorEnabled: true }) },
};

function normalized(sql) {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

function snapshotMatches(params) {
  if (
    state.booth.status === "closed" ||
    state.booth.archivedAt
  ) {
    return false;
  }
  const expected = JSON.parse(String(params[6]));
  const current = [...state.inventory]
    .sort((left, right) => left.productId - right.productId)
    .map((item) => [
      item.productId,
      item.opening,
      item.sold,
      item.adjusted,
    ]);
  return JSON.stringify(current) === JSON.stringify(expected);
}

class InventoryStatement {
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
      const organizationId = Number(this.params[0]);
      if (
        organizationId !== state.actor.organizationId ||
        !this.params.includes(state.actor.clerkUserId)
      ) {
        return [];
      }
      return [[
        state.actor.userId,
        21,
        state.actor.organizationId,
        state.actor.role,
        "active",
        false,
      ]];
    }
    throw new Error(`Unexpected authorization query: ${sql}`);
  }

  async first() {
    const sql = normalized(this.sql);
    if (sql.includes("select id, status, archived_at as archivedat from booths")) {
      const [boothId, organizationId] = this.params.map(Number);
      return boothId === state.booth.id &&
        organizationId === state.booth.organizationId
        ? {
            id: state.booth.id,
            status: state.booth.status,
            archivedAt: state.booth.archivedAt,
          }
        : null;
    }
    if (sql.includes("select count(*) as count from products")) {
      return { count: this.params.length - 1 };
    }
    throw new Error(`Unexpected first query: ${sql}`);
  }

  async all() {
    const sql = normalized(this.sql);
    if (sql.includes("from inventory where booth_id")) {
      return {
        results: state.inventory
          .map((item) => ({ ...item }))
          .sort((left, right) => left.productId - right.productId),
      };
    }
    if (sql.includes("select id from products") && sql.includes("active = 1")) {
      return { results: [{ id: 1 }] };
    }
    if (sql.includes("from products p") && sql.includes("left join inventory")) {
      const item = state.inventory.find((candidate) => candidate.productId === 1);
      return {
        results: [{
          id: 1,
          name: "Thin Mints",
          barcode: "thin-mints",
          price: 6,
          active: 1,
          configured: item ? 1 : 0,
          opening:
            item && item.opening === 0 && item.sold === 0 && item.adjusted === 0
              ? null
              : item?.opening ?? null,
          sold: item?.sold ?? null,
          adjusted: item?.adjusted ?? null,
          troopAvailable: state.troopAvailable,
        }],
      };
    }
    throw new Error(`Unexpected all query: ${sql}`);
  }
}

class InventoryD1 {
  prepare(sql) {
    return new InventoryStatement(sql);
  }

  async batch(statements) {
    if (state.concurrentBeforeBatch) {
      const mutate = state.concurrentBeforeBatch;
      state.concurrentBeforeBatch = null;
      mutate();
    }
    const inventoryStatement = statements.at(-1);
    const guardPassed = snapshotMatches(inventoryStatement.params);
    const results = statements.map(() => ({
      success: true,
      meta: { changes: guardPassed ? 1 : 0 },
    }));
    if (!guardPassed) return results;

    const [boothId, productId, opening] = inventoryStatement.params.map(Number);
    assert.equal(boothId, state.booth.id);
    const current = state.inventory.find((item) => item.productId === productId);
    const previousOpening = current?.opening || 0;
    state.troopAvailable -= opening - previousOpening;
    if (current) {
      current.opening = opening;
    } else {
      state.inventory.push({ productId, opening, sold: 0, adjusted: 0 });
    }
    state.ledger.push({
      organizationId: state.actor.organizationId,
      boothId,
      productId,
      actorUserId: state.actor.userId,
      delta: opening - previousOpening,
    });
    const auditStatement = statements.find((statement) =>
      normalized(statement.sql).includes(
        "insert into inventory_configuration_audit",
      )
    );
    state.audits.push({
      organizationId: Number(auditStatement.params[0]),
      boothId: Number(auditStatement.params[1]),
      actorUserId: Number(auditStatement.params[2]),
      before: JSON.parse(String(auditStatement.params[3])),
      after: JSON.parse(String(auditStatement.params[4])),
      createdAt: String(auditStatement.params[5]),
    });
    return results;
  }
}

globalThis.__CLOUDFLARE_ENV__ = {
  DB: new InventoryD1(),
  BOOTH_LIVE_ROOMS: {
    getByName(name) {
      return {
        async fetch(_url, init) {
          state.broadcasts.push({
            room: name,
            body: JSON.parse(String(init.body)),
          });
          return Response.json({ revision: state.broadcasts.length });
        },
      };
    },
  },
};

const route = await import("../app/api/admin/booth-inventory/route.ts");
const {
  buildInventorySnapshotGuard,
  createInventoryRevision,
  mergeUnrelatedAllocationDrafts,
  minimumSafeOpening,
  normalizeAllocationSubmission,
  remainingInventory,
  validateAllocationDraft,
} = await import("../lib/inventory-allocation.ts");

function reset({
  status = "live",
  archivedAt = null,
  opening = 10,
  sold = 4,
  adjusted = 0,
} = {}) {
  state.actor.organizationId = 1;
  state.actor.role = "admin";
  state.booth = {
    id: 100,
    organizationId: 1,
    status,
    archivedAt,
  };
  state.inventory = [{ productId: 1, opening, sold, adjusted }];
  state.troopAvailable = 100 - opening;
  state.ledger = [];
  state.audits = [];
  state.broadcasts = [];
  state.concurrentBeforeBatch = null;
}

async function revision() {
  return createInventoryRevision(state.inventory, {
    status: state.booth.status,
    archivedAt: state.booth.archivedAt,
  });
}

function saveRequest(opening, expectedRevision) {
  return new Request("https://app.example/api/admin/booth-inventory", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      origin: "https://app.example",
    },
    body: JSON.stringify({
      organizationId: 1,
      boothId: 100,
      expectedRevision,
      allocations: [{ productId: 1, opening }],
    }),
  });
}

test("allocation math includes sales, returns, and prior adjustments", () => {
  assert.equal(minimumSafeOpening({ sold: 0, adjusted: 0 }), 0);
  assert.equal(minimumSafeOpening({ sold: 7, adjusted: 0 }), 7);
  assert.equal(minimumSafeOpening({ sold: 7, adjusted: -2 }), 9);
  assert.equal(minimumSafeOpening({ sold: 7, adjusted: 3 }), 4);
  assert.equal(
    remainingInventory({ productId: 1, opening: 9, sold: 7, adjusted: -2 }),
    0,
  );
  assert.deepEqual(
    validateAllocationDraft({ opening: 8, sold: 7, adjusted: -2 }),
    { minimum: 9, invalid: true },
  );
  assert.deepEqual(
    validateAllocationDraft({ opening: 9, sold: 7, adjusted: -2 }),
    { minimum: 9, invalid: false },
  );
  assert.deepEqual(
    validateAllocationDraft({ opening: null, sold: 1, adjusted: 0 }),
    { minimum: 1, invalid: true },
  );
});

test("submission normalizes an existing cleared allocation without adding untouched blanks", () => {
  const baseline = [
    { id: 1, active: 1, opening: 10, configured: 1 },
    { id: 2, active: 1, opening: null, configured: 0 },
  ];
  const drafts = [
    { id: 1, active: 1, opening: null, configured: 1 },
    { id: 2, active: 1, opening: null, configured: 0 },
  ];
  assert.deepEqual(
    normalizeAllocationSubmission(drafts, baseline),
    [{ productId: 1, opening: 0 }],
  );
});

test("conflict refresh preserves only unrelated allocation drafts", () => {
  const baseline = [
    { id: 1, opening: 10, sold: 1, adjusted: 0 },
    { id: 2, opening: 8, sold: 0, adjusted: 0 },
  ];
  const drafts = [
    { id: 1, opening: 12, sold: 1, adjusted: 0 },
    { id: 2, opening: 9, sold: 0, adjusted: 0 },
  ];
  const latest = [
    { id: 1, opening: 10, sold: 2, adjusted: 0 },
    { id: 2, opening: 8, sold: 0, adjusted: 0 },
  ];
  assert.deepEqual(
    mergeUnrelatedAllocationDrafts(latest, baseline, drafts),
    [
      latest[0],
      { ...latest[1], opening: 9 },
    ],
  );
});

test("the guarded allocation upsert executes atomically in SQLite", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE booths (
      id INTEGER PRIMARY KEY,
      organization_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      archived_at TEXT
    );
    CREATE TABLE inventory (
      booth_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      opening INTEGER NOT NULL,
      sold INTEGER NOT NULL,
      adjusted INTEGER NOT NULL,
      UNIQUE (booth_id, product_id)
    );
    INSERT INTO booths VALUES (100, 1, 'live', NULL);
    INSERT INTO inventory VALUES (100, 1, 10, 4, 0);
  `);
  const current = [{
    productId: 1,
    opening: 10,
    sold: 4,
    adjusted: 0,
  }];
  const guard = buildInventorySnapshotGuard(100, 1, current);
  const statement = database.prepare(`
    INSERT INTO inventory (booth_id, product_id, opening, sold, adjusted)
    SELECT ?, ?, ?, 0, 0 WHERE ${guard.sql}
    ON CONFLICT (booth_id, product_id)
    DO UPDATE SET opening = excluded.opening
  `);
  const result = statement.run(100, 1, 12, ...guard.params);
  assert.equal(result.changes, 1);
  assert.equal(
    database.prepare(
      "SELECT opening FROM inventory WHERE booth_id = 100 AND product_id = 1",
    ).get().opening,
    12,
  );
  const staleResult = statement.run(100, 1, 14, ...guard.params);
  assert.equal(staleResult.changes, 0);
  database.close();
});

test("no-activity, sales, prior-adjustment, and pending-closure inventory remains editable", async () => {
  for (const scenario of [
    { status: "live", sold: 0, adjusted: 0 },
    { status: "live", sold: 4, adjusted: 0 },
    { status: "live", sold: 0, adjusted: 2 },
    { status: "pending_closure", sold: 4, adjusted: -1 },
  ]) {
    reset(scenario);
    const response = await route.GET(
      new Request(
        "https://app.example/api/admin/booth-inventory?organizationId=1&boothId=100",
      ),
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.editable, true);
    assert.equal(payload.inventory[0].sold, scenario.sold);
    assert.equal(payload.inventory[0].adjusted, scenario.adjusted);
    assert.match(payload.revision, /^[a-f0-9]{64}$/);
  }
});

test("closed and archived booths reject allocation changes", async () => {
  for (const lifecycle of [
    { status: "closed", archivedAt: null },
    { status: "live", archivedAt: "2026-07-28T00:00:00.000Z" },
  ]) {
    reset(lifecycle);
    const response = await route.PUT(saveRequest(12, await revision()));
    assert.equal(response.status, 409);
    assert.equal(state.inventory[0].opening, 10);
    assert.equal(state.audits.length, 0);
  }
});

test("allocations can increase after sales and reduce to the safe minimum", async () => {
  reset({ opening: 10, sold: 4, adjusted: -1 });
  let response = await route.PUT(saveRequest(12, await revision()));
  assert.equal(response.status, 200);
  assert.equal(state.inventory[0].opening, 12);
  assert.equal(state.troopAvailable, 88);

  response = await route.PUT(saveRequest(5, await revision()));
  assert.equal(response.status, 200);
  assert.equal(state.inventory[0].opening, 5);
  assert.equal(remainingInventory(state.inventory[0]), 0);
  assert.equal(state.ledger.length, 2);
  assert.equal(state.audits.length, 2);
  assert.equal(state.audits.at(-1).organizationId, 1);
  assert.equal(state.audits.at(-1).boothId, 100);
  assert.equal(state.audits.at(-1).actorUserId, 11);
  assert.equal(state.audits.at(-1).before[0].opening, 12);
  assert.equal(state.audits.at(-1).after[0].opening, 5);
  assert.match(state.audits.at(-1).createdAt, /^20\d\d-/);
  assert.deepEqual(state.broadcasts.at(-1).body.topics, ["inventory"]);
});

test("server rejects a reduction below the current minimum", async () => {
  reset({ opening: 10, sold: 6, adjusted: -1 });
  const response = await route.PUT(saveRequest(6, await revision()));
  assert.equal(response.status, 422);
  const payload = await response.json();
  assert.equal(payload.code, "negative_inventory");
  assert.equal(payload.minimum, 7);
  assert.equal(state.inventory[0].opening, 10);
  assert.equal(state.ledger.length, 0);
  assert.equal(state.audits.length, 0);
});

test("clearing a no-activity allocation returns stock and persists unallocated", async () => {
  reset({ opening: 10, sold: 0, adjusted: 0 });
  const response = await route.PUT(saveRequest(0, await revision()));
  assert.equal(response.status, 200);
  assert.equal(state.inventory[0].opening, 0);
  assert.equal(state.troopAvailable, 100);
  assert.deepEqual(state.ledger.at(-1), {
    organizationId: 1,
    boothId: 100,
    productId: 1,
    actorUserId: 11,
    delta: -10,
  });
  assert.equal(state.audits.at(-1).before[0].opening, 10);
  assert.equal(state.audits.at(-1).after[0].opening, 0);

  const loaded = await route.GET(
    new Request(
      "https://app.example/api/admin/booth-inventory?organizationId=1&boothId=100",
    ),
  );
  assert.equal((await loaded.json()).inventory[0].opening, null);
  assert.deepEqual(state.broadcasts.at(-1).body.topics, ["inventory"]);
});

test("clearing with sales or adjustments follows the authoritative minimum", async () => {
  reset({ opening: 10, sold: 2, adjusted: 0 });
  let response = await route.PUT(saveRequest(0, await revision()));
  assert.equal(response.status, 422);
  assert.equal((await response.json()).minimum, 2);

  reset({ opening: 10, sold: 5, adjusted: -1 });
  response = await route.PUT(saveRequest(0, await revision()));
  assert.equal(response.status, 422);
  assert.equal((await response.json()).minimum, 6);

  reset({ opening: 10, sold: 5, adjusted: 5 });
  response = await route.PUT(saveRequest(0, await revision()));
  assert.equal(response.status, 200);
  assert.equal(state.inventory[0].opening, 0);
  assert.equal(remainingInventory(state.inventory[0]), 0);
});

test("omitting an existing active allocation is never reported as a successful clear", async () => {
  for (const scenario of [
    { sold: 0, expectedStatus: 400, expectedCode: "allocation_intent_required" },
    { sold: 2, expectedStatus: 422, expectedCode: "negative_inventory" },
  ]) {
    reset({ opening: 10, sold: scenario.sold, adjusted: 0 });
    const response = await route.PUT(
      new Request("https://app.example/api/admin/booth-inventory", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          origin: "https://app.example",
        },
        body: JSON.stringify({
          organizationId: 1,
          boothId: 100,
          expectedRevision: await revision(),
          allocations: [],
        }),
      }),
    );
    assert.equal(response.status, scenario.expectedStatus);
    assert.equal((await response.json()).code, scenario.expectedCode);
    assert.equal(state.inventory[0].opening, 10);
    assert.equal(state.ledger.length, 0);
    assert.equal(state.audits.length, 0);
  }
});

test("a stale concurrent clear returns inventory_conflict without audit effects", async () => {
  reset({ opening: 10, sold: 0, adjusted: 0 });
  const expectedRevision = await revision();
  state.concurrentBeforeBatch = () => {
    state.inventory[0].sold = 1;
  };
  const response = await route.PUT(saveRequest(0, expectedRevision));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "inventory_conflict");
  assert.equal(state.inventory[0].opening, 10);
  assert.equal(state.inventory[0].sold, 1);
  assert.equal(state.ledger.length, 0);
  assert.equal(state.audits.length, 0);
  assert.equal(state.broadcasts.length, 0);
});

test("concurrent sales, adjustments, and allocations cause atomic stale conflicts", async () => {
  for (const mutate of [
    () => {
      state.inventory[0].sold += 1;
    },
    () => {
      state.inventory[0].adjusted += 1;
    },
    () => {
      state.inventory[0].opening += 1;
    },
  ]) {
    reset({ opening: 10, sold: 4, adjusted: 0 });
    const expectedRevision = await revision();
    state.concurrentBeforeBatch = mutate;
    const response = await route.PUT(saveRequest(12, expectedRevision));
    assert.equal(response.status, 409);
    const payload = await response.json();
    assert.equal(payload.code, "inventory_conflict");
    assert.equal(state.ledger.length, 0);
    assert.equal(state.audits.length, 0);
    assert.equal(state.broadcasts.length, 0);
  }
});
