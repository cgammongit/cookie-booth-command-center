import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const SUPER_ADMIN_ID = "clerk-super-admin";
const REGULAR_ADMIN_ID = "clerk-organization-admin";
const SELECTED_ORGANIZATION_ID = 1;
const OTHER_ORGANIZATION_ID = 2;

const OPERATIONAL_TABLES = [
  "reconciliation_items",
  "reconciliations",
  "transactions",
  "sales",
  "inventory",
  "assignments",
  "admin_alerts",
  "booth_lifecycle_audit",
  "inventory_configuration_audit",
  "inventory_ledger",
  "troop_inventory_balances",
  "access_audit_log",
  "product_catalog_audit",
  "booths",
];
const PROTECTED_TABLES = [
  "organizations",
  "users",
  "memberships",
  "organization_invitations",
  "products",
];
const SNAPSHOT_TABLES = [
  ...OPERATIONAL_TABLES,
  ...PROTECTED_TABLES,
  "super_admin_audit_log",
];

globalThis.__CLERK_TEST_AUTH__ = { userId: SUPER_ADMIN_ID };

function normalize(sql) {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

class D1Statement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql;
    this.params = [];
  }

  bind(...params) {
    this.params = params;
    return this;
  }

  async first() {
    return this.database.sqlite.prepare(this.sql).get(...this.params) ?? null;
  }

  async all() {
    return {
      results: this.database.sqlite.prepare(this.sql).all(...this.params),
      success: true,
      meta: {},
    };
  }

  async run() {
    this.database.beforeStatement(this.sql);
    const result = this.database.sqlite.prepare(this.sql).run(...this.params);
    return {
      success: true,
      meta: {
        changes: Number(result.changes),
        last_row_id: Number(result.lastInsertRowid),
      },
    };
  }
}

class TransactionalD1 {
  constructor() {
    this.sqlite = new DatabaseSync(":memory:");
    this.failOn = null;
    this.calls = 0;
    createSchema(this.sqlite);
    seed(this.sqlite);
  }

  prepare(sql) {
    this.calls += 1;
    return new D1Statement(this, sql);
  }

  beforeStatement(sql) {
    if (this.failOn && normalize(sql).includes(this.failOn)) {
      throw new Error(`Injected D1 failure for ${this.failOn}`);
    }
  }

  async batch(statements) {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) {
        results.push(await statement.run());
      }
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

function createSchema(database) {
  database.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE organizations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL
    );
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      clerk_user_id TEXT UNIQUE,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      last_synced_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE memberships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      can_invite_users INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT '',
      UNIQUE (organization_id, user_id)
    );
    CREATE TABLE organization_invitations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL,
      membership_id INTEGER NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL,
      can_invite_users INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      clerk_invitation_id TEXT NOT NULL UNIQUE,
      invited_by_user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      accepted_at TEXT,
      cancelled_at TEXT
    );
    CREATE TABLE products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      barcode TEXT NOT NULL,
      price REAL NOT NULL DEFAULT 6,
      active INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT '',
      UNIQUE (organization_id, barcode)
    );
    CREATE TABLE booths (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      address TEXT NOT NULL,
      location_name TEXT,
      google_place_id TEXT,
      latitude REAL,
      longitude REAL,
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      archived_at TEXT,
      archived_by_user_id INTEGER,
      archive_reason TEXT,
      archive_kind TEXT
    );
    CREATE TABLE assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booth_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      UNIQUE (booth_id, user_id)
    );
    CREATE TABLE inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booth_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      opening INTEGER NOT NULL,
      sold INTEGER NOT NULL DEFAULT 0,
      adjusted INTEGER NOT NULL DEFAULT 0,
      UNIQUE (booth_id, product_id)
    );
    CREATE TABLE sales (
      id TEXT PRIMARY KEY,
      booth_id INTEGER NOT NULL,
      operator_id INTEGER NOT NULL,
      payment_method TEXT NOT NULL CHECK (
        payment_method IN ('cash', 'credit_card', 'venmo_paypal')
      ),
      box_count INTEGER NOT NULL CHECK (box_count > 0),
      total_amount REAL NOT NULL CHECK (total_amount >= 0),
      created_at TEXT NOT NULL
    );
    CREATE TABLE transactions (
      id TEXT PRIMARY KEY,
      sale_id TEXT,
      booth_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      operator_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      amount REAL NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE reconciliations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booth_id INTEGER NOT NULL UNIQUE,
      closed_by INTEGER NOT NULL,
      cash_total REAL NOT NULL,
      expected_cash_total REAL NOT NULL DEFAULT 0,
      cash_discrepancy REAL NOT NULL DEFAULT 0,
      digital_total REAL NOT NULL,
      credit_card_total REAL NOT NULL DEFAULT 0,
      venmo_paypal_total REAL NOT NULL DEFAULT 0,
      gross_total REAL NOT NULL DEFAULT 0,
      expected_box_count INTEGER NOT NULL DEFAULT 0,
      actual_box_count INTEGER NOT NULL DEFAULT 0,
      inventory_discrepancy_count INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      closed_at TEXT NOT NULL
    );
    CREATE TABLE reconciliation_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reconciliation_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      expected_remaining INTEGER NOT NULL CHECK (expected_remaining >= 0),
      actual_remaining INTEGER NOT NULL CHECK (actual_remaining >= 0),
      discrepancy INTEGER NOT NULL,
      returned_to_troop INTEGER NOT NULL CHECK (returned_to_troop >= 0),
      UNIQUE (reconciliation_id, product_id)
    );
    CREATE TABLE troop_inventory_balances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      total_remaining INTEGER NOT NULL DEFAULT 0 CHECK (total_remaining >= 0),
      available INTEGER NOT NULL DEFAULT 0 CHECK (
        available >= 0 AND available <= total_remaining
      ),
      updated_at TEXT NOT NULL,
      UNIQUE (organization_id, product_id)
    );
    CREATE TABLE inventory_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      booth_id INTEGER,
      actor_user_id INTEGER,
      movement_type TEXT NOT NULL CHECK (movement_type IN (
        'initial_order', 'replenishment', 'booth_allocation', 'booth_return',
        'booth_sale', 'trade_in', 'trade_out', 'council_return', 'damage',
        'loss', 'correction_in', 'correction_out', 'legacy_migration'
      )),
      total_delta INTEGER NOT NULL DEFAULT 0,
      available_delta INTEGER NOT NULL DEFAULT 0,
      booth_delta INTEGER NOT NULL DEFAULT 0,
      reason TEXT,
      reference TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE admin_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL,
      booth_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      muted INTEGER NOT NULL DEFAULT 0,
      acknowledged_by_user_id INTEGER,
      acknowledged_at TEXT,
      muted_by_user_id INTEGER,
      muted_at TEXT,
      resolution_note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE booth_lifecycle_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL,
      booth_id INTEGER NOT NULL,
      actor_user_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      details_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE inventory_configuration_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL,
      booth_id INTEGER NOT NULL,
      actor_user_id INTEGER NOT NULL,
      before_json TEXT NOT NULL,
      after_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE access_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL,
      actor_user_id INTEGER NOT NULL,
      target_membership_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      before_json TEXT NOT NULL,
      after_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE product_catalog_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      actor_user_id INTEGER NOT NULL,
      before_json TEXT NOT NULL,
      after_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE super_admin_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_clerk_user_id TEXT NOT NULL,
      actor_user_id INTEGER,
      actor_display_name TEXT NOT NULL,
      action TEXT NOT NULL,
      target_organization_id INTEGER NOT NULL,
      target_organization_name TEXT NOT NULL,
      reason TEXT,
      deleted_counts_json TEXT NOT NULL,
      outcome TEXT NOT NULL,
      request_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}

function seed(database) {
  database.exec(`
    INSERT INTO organizations VALUES
      (1, 'Demo Troop'),
      (2, 'Neighbor Troop');

    INSERT INTO users VALUES
      (10, '${SUPER_ADMIN_ID}', 'super@example.test', 'Chris', 'active', '2026-01-01T00:00:00.000Z'),
      (11, '${REGULAR_ADMIN_ID}', 'admin@example.test', 'Regular Admin', 'active', '2026-01-02T00:00:00.000Z'),
      (12, 'clerk-volunteer', 'volunteer@example.test', 'Volunteer', 'disabled', '2026-01-03T00:00:00.000Z'),
      (20, 'clerk-neighbor', 'neighbor@example.test', 'Neighbor Admin', 'active', '2026-01-04T00:00:00.000Z');

    INSERT INTO memberships VALUES
      (1, 1, 10, 'admin', 'active', 1, '2026-01-01', '2026-01-02'),
      (2, 1, 11, 'lead', 'active', 0, '2026-01-03', '2026-01-04'),
      (3, 1, 12, 'volunteer', 'suspended', 0, '2026-01-05', '2026-01-06'),
      (4, 2, 20, 'admin', 'active', 1, '2026-01-07', '2026-01-08');

    INSERT INTO organization_invitations VALUES
      (1, 1, 3, 'pending-demo@example.test', 'auditor', 0, 'pending',
       'invite-demo', 10, '2026-01-09', '2026-01-10', NULL, NULL),
      (2, 2, 4, 'pending-neighbor@example.test', 'lead', 1, 'pending',
       'invite-neighbor', 20, '2026-01-11', '2026-01-12', NULL, NULL);

    INSERT INTO products VALUES
      (101, 1, 'Thin Mints Custom', 'DEMO-111', 6.25, 1, '2026-02-01T01:02:03.000Z'),
      (102, 1, 'Retired Raspberry', 'DEMO-222', 7.75, 0, '2026-02-02T02:03:04.000Z'),
      (201, 2, 'Neighbor Samoas', 'OTHER-333', 8.5, 1, '2026-02-03T03:04:05.000Z'),
      (202, 2, 'Neighbor Inactive', 'OTHER-444', 5.5, 0, '2026-02-04T04:05:06.000Z');

    INSERT INTO booths VALUES
      (100, 1, 'Scheduled Demo', '1 Main St', 'Market', 'place-100', 40.1, -75.1,
       '2026-03-01', '2026-03-02', 'scheduled', NULL, NULL, NULL, NULL),
      (101, 1, 'Live Demo', '2 Main St', 'Mall', 'place-101', 40.2, -75.2,
       '2026-03-03', '2026-03-04', 'live', NULL, NULL, NULL, NULL),
      (102, 1, 'Closed Demo', '3 Main St', 'School', 'place-102', 40.3, -75.3,
       '2026-03-05', '2026-03-06', 'closed', NULL, NULL, NULL, NULL),
      (103, 1, 'Archived Demo', '4 Main St', 'Library', 'place-103', 40.4, -75.4,
       '2026-03-07', '2026-03-08', 'closed', '2026-03-09', 10,
       'Demo cleanup', 'manual'),
      (200, 2, 'Neighbor Live', '9 Oak St', 'Neighbor Mall', 'place-200', 41.1, -76.1,
       '2026-04-01', '2026-04-02', 'live', NULL, NULL, NULL, NULL),
      (201, 2, 'Neighbor Archived', '10 Oak St', 'Neighbor School', 'place-201', 41.2, -76.2,
       '2026-04-03', '2026-04-04', 'closed', '2026-04-05', 20,
       'Neighbor archive', 'manual');

    INSERT INTO assignments VALUES
      (1001, 100, 11, 'lead'),
      (1002, 101, 12, 'volunteer'),
      (1003, 103, 10, 'auditor'),
      (2001, 200, 20, 'lead'),
      (2002, 201, 20, 'auditor');

    INSERT INTO inventory VALUES
      (1101, 100, 101, 30, 4, -1),
      (1102, 101, 102, 25, 3, 2),
      (1103, 102, 101, 20, 10, 0),
      (1104, 103, 102, 15, 5, -2),
      (2101, 200, 201, 40, 6, 1),
      (2102, 201, 202, 18, 8, 0);

    INSERT INTO sales VALUES
      ('sale-demo-cash', 100, 11, 'cash', 2, 12.5, '2026-05-01'),
      ('sale-demo-card', 101, 12, 'credit_card', 3, 23.25, '2026-05-02'),
      ('sale-demo-wallet', 102, 10, 'venmo_paypal', 1, 6.25, '2026-05-03'),
      ('sale-other-cash', 200, 20, 'cash', 4, 34, '2026-05-04'),
      ('sale-other-card', 201, 20, 'credit_card', 2, 11, '2026-05-05');

    INSERT INTO transactions VALUES
      ('txn-demo-line-1', 'sale-demo-cash', 100, 101, 11, 'sale', 2, 12.5, NULL, '2026-05-01'),
      ('txn-demo-line-2', 'sale-demo-card', 101, 102, 12, 'sale', 3, 23.25, NULL, '2026-05-02'),
      ('txn-demo-adjust', NULL, 103, 102, 10, 'adjustment', -2, 0, 'Damage', '2026-05-03'),
      ('txn-other-line', 'sale-other-cash', 200, 201, 20, 'sale', 4, 34, NULL, '2026-05-04'),
      ('txn-other-correction', NULL, 201, 202, 20, 'correction', 1, 5.5, 'Count', '2026-05-05');

    INSERT INTO reconciliations VALUES
      (1201, 102, 10, 20, 18, 2, 12.5, 6.25, 6.25, 32.5, 5, 6, 1,
       'Demo close', '2026-06-01'),
      (2201, 201, 20, 15, 15, 0, 11, 11, 0, 26, 6, 6, 0,
       'Neighbor close', '2026-06-02');

    INSERT INTO reconciliation_items VALUES
      (1301, 1201, 101, 10, 9, -1, 9),
      (1302, 1201, 102, 8, 8, 0, 8),
      (2301, 2201, 201, 12, 12, 0, 12),
      (2302, 2201, 202, 10, 9, -1, 9);

    INSERT INTO troop_inventory_balances VALUES
      (1401, 1, 101, 90, 25, '2026-06-03'),
      (1402, 1, 102, 70, 30, '2026-06-04'),
      (2401, 2, 201, 100, 40, '2026-06-05'),
      (2402, 2, 202, 80, 35, '2026-06-06');

    INSERT INTO inventory_ledger VALUES
      (1501, 1, 101, NULL, 10, 'initial_order', 100, 100, 0, 'Initial', 'order-1', '2026-07-01'),
      (1502, 1, 101, 100, 10, 'booth_allocation', 0, -30, 30, 'Opening', 'booth-100', '2026-07-02'),
      (1503, 1, 102, NULL, 10, 'trade_in', 10, 10, 0, 'Trade', 'trade-1', '2026-07-03'),
      (1504, 1, 102, 101, 12, 'booth_sale', -3, 0, -3, 'Sale', 'sale-demo-card', '2026-07-04'),
      (1505, 1, 101, NULL, 10, 'council_return', -5, -5, 0, 'Council', 'return-1', '2026-07-05'),
      (1506, 1, 102, NULL, 10, 'correction_out', -2, -2, 0, 'Count', 'correction-1', '2026-07-06'),
      (2501, 2, 201, NULL, 20, 'initial_order', 120, 120, 0, 'Initial', 'order-2', '2026-07-07'),
      (2502, 2, 201, 200, 20, 'booth_allocation', 0, -40, 40, 'Opening', 'booth-200', '2026-07-08'),
      (2503, 2, 202, NULL, 20, 'replenishment', 20, 20, 0, 'Replenish', 'order-3', '2026-07-09'),
      (2504, 2, 202, 201, 20, 'booth_return', 0, 9, -9, 'Close', 'recon-2201', '2026-07-10');

    INSERT INTO admin_alerts VALUES
      (1601, 1, 103, 'manual_archive_with_activity', 'acknowledged', 1, 10,
       '2026-07-11', 10, '2026-07-12', 'Reviewed demo alert', '2026-07-11', '2026-07-12'),
      (2601, 2, 201, 'manual_archive_with_activity', 'review', 0, 20,
       '2026-07-13', NULL, NULL, 'Neighbor review', '2026-07-13', '2026-07-14');

    INSERT INTO booth_lifecycle_audit VALUES
      (1701, 1, 103, 10, 'alert_acknowledged', '{"status":"acknowledged"}', '2026-07-15'),
      (1702, 1, 103, 10, 'alert_muted', '{"muted":true}', '2026-07-16'),
      (2701, 2, 201, 20, 'alert_flagged', '{"status":"review"}', '2026-07-17');

    INSERT INTO inventory_configuration_audit VALUES
      (1801, 1, 100, 10, '{"opening":20}', '{"opening":30}', '2026-07-18'),
      (2801, 2, 200, 20, '{"opening":30}', '{"opening":40}', '2026-07-19');

    INSERT INTO access_audit_log VALUES
      (1901, 1, 10, 2, 'booth_assigned', '{}', '{"boothId":100}', '2026-07-20'),
      (1902, 1, 10, 3, 'status_changed', '{"status":"active"}', '{"status":"suspended"}', '2026-07-21'),
      (2901, 2, 20, 4, 'booth_assigned', '{}', '{"boothId":200}', '2026-07-22');

    INSERT INTO product_catalog_audit VALUES
      (1951, 1, 101, 10, '{"price":6}', '{"price":6.25}', '2026-07-23'),
      (1952, 1, 102, 10, '{"active":1}', '{"active":0}', '2026-07-24'),
      (2951, 2, 201, 20, '{"price":8}', '{"price":8.5}', '2026-07-25');

    INSERT INTO super_admin_audit_log VALUES
      (1, '${SUPER_ADMIN_ID}', 10, 'Chris', 'organization_data_purge_failed',
       1, 'Demo Troop', 'Historical demo failure', '{"booths":0}', 'failure',
       'historical-demo-request', '2026-07-26'),
      (2, '${SUPER_ADMIN_ID}', 10, 'Chris', 'organization_data_purged',
       2, 'Neighbor Troop', 'Historical neighbor event', '{"booths":0}', 'success',
       'historical-neighbor-request', '2026-07-27');
  `);
}

const database = new TransactionalD1();
globalThis.__CLOUDFLARE_ENV__ = {
  DB: database,
  SUPER_ADMIN_CLERK_USER_IDS: SUPER_ADMIN_ID,
};

const route = await import("../app/api/super-admin/organizations/route.ts");

function reset({ userId = SUPER_ADMIN_ID } = {}) {
  database.sqlite.close();
  database.sqlite = new DatabaseSync(":memory:");
  database.failOn = null;
  database.calls = 0;
  createSchema(database.sqlite);
  seed(database.sqlite);
  globalThis.__CLERK_TEST_AUTH__.userId = userId;
}

function rows(table) {
  return database.sqlite.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
}

function snapshotDatabase() {
  return Object.fromEntries(SNAPSHOT_TABLES.map((table) => [table, rows(table)]));
}

function rowsWithIds(table, expectedRows) {
  if (!expectedRows.length) return [];
  const placeholders = expectedRows.map(() => "?").join(", ");
  return database.sqlite.prepare(
    `SELECT * FROM ${table} WHERE id IN (${placeholders}) ORDER BY id`,
  ).all(...expectedRows.map(({ id }) => id));
}

function rowsForOrganization(snapshot, organizationId, table) {
  const boothIds = new Set(
    snapshot.booths
      .filter((row) => row.organization_id === organizationId)
      .map(({ id }) => id),
  );
  const reconciliationIds = new Set(
    snapshot.reconciliations
      .filter((row) => boothIds.has(row.booth_id))
      .map(({ id }) => id),
  );
  const userIds = new Set(
    snapshot.memberships
      .filter((row) => row.organization_id === organizationId)
      .map(({ user_id }) => user_id),
  );

  switch (table) {
    case "organizations":
      return snapshot.organizations.filter(({ id }) => id === organizationId);
    case "users":
      return snapshot.users.filter(({ id }) => userIds.has(id));
    case "memberships":
    case "organization_invitations":
    case "products":
    case "admin_alerts":
    case "booth_lifecycle_audit":
    case "inventory_configuration_audit":
    case "inventory_ledger":
    case "troop_inventory_balances":
    case "access_audit_log":
    case "product_catalog_audit":
    case "booths":
      return snapshot[table].filter(({ organization_id }) => organization_id === organizationId);
    case "assignments":
    case "inventory":
    case "transactions":
    case "sales":
    case "reconciliations":
      return snapshot[table].filter(({ booth_id }) => boothIds.has(booth_id));
    case "reconciliation_items":
      return snapshot.reconciliation_items.filter(
        ({ reconciliation_id }) => reconciliationIds.has(reconciliation_id),
      );
    default:
      throw new Error(`No organization relationship defined for ${table}`);
  }
}

function protectedSnapshot(snapshot, organizationId) {
  return Object.fromEntries(
    PROTECTED_TABLES.map((table) => [
      table,
      rowsForOrganization(snapshot, organizationId, table),
    ]),
  );
}

function operationalSnapshot(snapshot, organizationId) {
  return Object.fromEntries(
    OPERATIONAL_TABLES.map((table) => [
      table,
      rowsForOrganization(snapshot, organizationId, table),
    ]),
  );
}

function assertRowsUnchanged(expectedByTable) {
  for (const [table, expectedRows] of Object.entries(expectedByTable)) {
    assert.deepEqual(
      rowsWithIds(table, expectedRows),
      expectedRows,
      `${table} rows must remain value-for-value unchanged`,
    );
  }
}

function assertRowsDeleted(expectedByTable) {
  for (const [table, expectedRows] of Object.entries(expectedByTable)) {
    assert.ok(expectedRows.length > 0, `${table} fixture must contain selected-tenant rows`);
    assert.deepEqual(
      rowsWithIds(table, expectedRows),
      [],
      `${table} selected-tenant rows must be deleted`,
    );
  }
}

function purgeRequest(organizationId = SELECTED_ORGANIZATION_ID) {
  return new Request("https://app.example/api/super-admin/organizations", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://app.example",
    },
    body: JSON.stringify({
      organizationId,
      confirmationName: "Demo Troop",
      acknowledged: true,
      reason: "Integration test",
    }),
  });
}

test("real Super Admin handlers reject unauthenticated callers without changing state", async () => {
  reset({ userId: null });
  const before = snapshotDatabase();

  const getResponse = await route.GET();
  assert.equal(getResponse.status, 403);
  assert.deepEqual(await getResponse.json(), {
    error: "Super Administrator access is required",
  });

  const postResponse = await route.POST(purgeRequest());
  assert.equal(postResponse.status, 403);
  assert.deepEqual(await postResponse.json(), {
    error: "Super Administrator access is required",
  });

  assert.equal(database.calls, 0, "unauthenticated requests must not reach D1");
  assert.deepEqual(snapshotDatabase(), before);
  assert.equal(
    rows("super_admin_audit_log").filter(({ action }) =>
      action === "organization_data_purged"
    ).length,
    before.super_admin_audit_log.filter(({ action }) =>
      action === "organization_data_purged"
    ).length,
  );
});

test("real Super Admin handlers reject a regular organization administrator", async () => {
  reset({ userId: REGULAR_ADMIN_ID });
  const before = snapshotDatabase();

  assert.equal((await route.GET()).status, 403);
  assert.equal((await route.POST(purgeRequest())).status, 403);
  assert.equal(database.calls, 0, "unauthorized requests must not reach D1");
  assert.deepEqual(snapshotDatabase(), before);
});

test("GET preview reports accurate organization-scoped counts", async () => {
  reset();

  const response = await route.GET();
  assert.equal(response.status, 200);
  const payload = await response.json();
  const demo = payload.organizations.find(({ id }) => id === SELECTED_ORGANIZATION_ID);
  const neighbor = payload.organizations.find(({ id }) => id === OTHER_ORGANIZATION_ID);

  assert.deepEqual(
    {
      members: demo.memberCount,
      products: demo.productCount,
      booths: demo.boothCount,
      inventoryTransactions: demo.inventoryTransactionCount,
      sales: demo.salesCount,
      auditEvents: demo.auditCount,
      latestActivityAt: demo.latestActivityAt,
    },
    {
      members: 3,
      products: 2,
      booths: 4,
      inventoryTransactions: 6,
      sales: 3,
      auditEvents: 7,
      latestActivityAt: "2026-07-21",
    },
  );
  assert.deepEqual(
    {
      members: neighbor.memberCount,
      products: neighbor.productCount,
      booths: neighbor.boothCount,
      inventoryTransactions: neighbor.inventoryTransactionCount,
      sales: neighbor.salesCount,
      auditEvents: neighbor.auditCount,
      latestActivityAt: neighbor.latestActivityAt,
    },
    {
      members: 1,
      products: 2,
      booths: 2,
      inventoryTransactions: 4,
      sales: 2,
      auditEvents: 4,
      latestActivityAt: "2026-07-22",
    },
  );
});

test("POST deletes the complete selected operational boundary and preserves both catalogs", async () => {
  reset();
  const before = snapshotDatabase();
  const selectedOperational = operationalSnapshot(before, SELECTED_ORGANIZATION_ID);
  const otherOperational = operationalSnapshot(before, OTHER_ORGANIZATION_ID);
  const selectedProtected = protectedSnapshot(before, SELECTED_ORGANIZATION_ID);
  const otherProtected = protectedSnapshot(before, OTHER_ORGANIZATION_ID);
  const permanentAuditBefore = before.super_admin_audit_log;

  const response = await route.POST(purgeRequest());
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.deletedCounts, {
    booths: 4,
    inventoryTransactions: 6,
    sales: 3,
    regularAuditEvents: 7,
  });

  assertRowsDeleted(selectedOperational);
  assertRowsUnchanged(otherOperational);
  assertRowsUnchanged(selectedProtected);
  assertRowsUnchanged(otherProtected);
  assertRowsUnchanged({ super_admin_audit_log: permanentAuditBefore });

  assert.deepEqual(
    rowsWithIds("products", selectedProtected.products),
    selectedProtected.products,
    "selected product id, organization, name, barcode, price, active state, and timestamp must survive",
  );
  assert.deepEqual(
    rowsWithIds("products", otherProtected.products),
    otherProtected.products,
    "other-tenant product catalog must remain value-for-value unchanged",
  );
});

test("successful purge and success audit are committed atomically", async () => {
  reset();

  const response = await route.POST(purgeRequest());
  const payload = await response.json();
  const audits = database.sqlite.prepare(`
    SELECT * FROM super_admin_audit_log
    WHERE request_id = ?
  `).all(payload.requestId);

  assert.equal(response.status, 200);
  assert.equal(audits.length, 1);
  const audit = audits[0];
  assert.equal(audit.action, "organization_data_purged");
  assert.equal(audit.target_organization_id, SELECTED_ORGANIZATION_ID);
  assert.equal(audit.target_organization_name, "Demo Troop");
  assert.equal(audit.actor_clerk_user_id, SUPER_ADMIN_ID);
  assert.equal(audit.actor_user_id, 10);
  assert.equal(audit.actor_display_name, "Chris");
  assert.equal(audit.reason, "Integration test");
  assert.equal(audit.outcome, "success");
  assert.equal(audit.request_id, payload.requestId);
  assert.match(audit.created_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(JSON.parse(audit.deleted_counts_json), payload.deletedCounts);
});

test("a batch failure rolls back every deletion and records a durable failed purge", async () => {
  reset();
  const before = snapshotDatabase();
  const selectedOperational = operationalSnapshot(before, SELECTED_ORGANIZATION_ID);
  const otherOperational = operationalSnapshot(before, OTHER_ORGANIZATION_ID);
  const selectedProtected = protectedSnapshot(before, SELECTED_ORGANIZATION_ID);
  const otherProtected = protectedSnapshot(before, OTHER_ORGANIZATION_ID);
  database.failOn = "delete from inventory_ledger";

  const response = await route.POST(purgeRequest());
  const payload = await response.json();
  assert.equal(response.status, 500);
  assert.deepEqual(
    { error: payload.error },
    { error: "The purge failed and operational data was not removed" },
  );
  assert.match(payload.requestId, /^[0-9a-f-]{36}$/);

  assertRowsUnchanged(selectedOperational);
  assertRowsUnchanged(otherOperational);
  assertRowsUnchanged(selectedProtected);
  assertRowsUnchanged(otherProtected);

  const audit = database.sqlite.prepare(`
    SELECT * FROM super_admin_audit_log
    WHERE request_id = ?
  `).get(payload.requestId);
  assert.ok(audit);
  assert.equal(audit.action, "organization_data_purge_failed");
  assert.equal(audit.outcome, "failure");
  assert.equal(audit.target_organization_id, SELECTED_ORGANIZATION_ID);
  assert.equal(audit.target_organization_name, "Demo Troop");
  assert.equal(audit.actor_clerk_user_id, SUPER_ADMIN_ID);
  assert.equal(audit.actor_user_id, 10);
  assert.equal(audit.actor_display_name, "Chris");
  assert.equal(audit.reason, "Integration test");
  assert.match(audit.created_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(JSON.parse(audit.deleted_counts_json), {
    booths: 4,
    inventoryTransactions: 6,
    sales: 3,
    regularAuditEvents: 7,
  });
});

test("existing permanent Super Admin audit history survives an organization purge", async () => {
  reset();
  const before = rows("super_admin_audit_log");

  assert.equal((await route.POST(purgeRequest())).status, 200);

  assertRowsUnchanged({ super_admin_audit_log: before });
  assert.equal(rows("super_admin_audit_log").length, before.length + 1);
});
