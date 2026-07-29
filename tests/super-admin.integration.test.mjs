import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const SUPER_ADMIN_ID = "clerk-super-admin";
const REGULAR_ADMIN_ID = "clerk-organization-admin";

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
    return { success: true, meta: { changes: Number(result.changes) } };
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

  count(table, organizationId) {
    const organizationColumn = {
      booths: "organization_id",
      inventory_ledger: "organization_id",
      access_audit_log: "organization_id",
      memberships: "organization_id",
      organization_invitations: "organization_id",
      products: "organization_id",
    }[table];
    if (organizationColumn) {
      return Number(this.sqlite.prepare(
        `SELECT COUNT(*) AS count FROM ${table} WHERE ${organizationColumn} = ?`,
      ).get(organizationId).count);
    }
    if (table === "sales") {
      return Number(this.sqlite.prepare(`
        SELECT COUNT(*) AS count FROM sales s
        JOIN booths b ON b.id = s.booth_id
        WHERE b.organization_id = ?
      `).get(organizationId).count);
    }
    throw new Error(`Unsupported count table: ${table}`);
  }
}

function createSchema(database) {
  database.exec(`
    CREATE TABLE organizations (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, clerk_user_id TEXT NOT NULL, display_name TEXT NOT NULL
    );
    CREATE TABLE memberships (
      id INTEGER PRIMARY KEY, organization_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
      role TEXT NOT NULL
    );
    CREATE TABLE organization_invitations (
      id INTEGER PRIMARY KEY, organization_id INTEGER NOT NULL, email TEXT NOT NULL
    );
    CREATE TABLE products (
      id INTEGER PRIMARY KEY, organization_id INTEGER NOT NULL, name TEXT NOT NULL,
      barcode TEXT NOT NULL, price REAL NOT NULL
    );
    CREATE TABLE booths (id INTEGER PRIMARY KEY, organization_id INTEGER NOT NULL);
    CREATE TABLE assignments (id INTEGER PRIMARY KEY, booth_id INTEGER NOT NULL);
    CREATE TABLE inventory (id INTEGER PRIMARY KEY, booth_id INTEGER NOT NULL);
    CREATE TABLE transactions (id INTEGER PRIMARY KEY, booth_id INTEGER NOT NULL);
    CREATE TABLE sales (
      id INTEGER PRIMARY KEY, booth_id INTEGER NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE reconciliations (id INTEGER PRIMARY KEY, booth_id INTEGER NOT NULL);
    CREATE TABLE reconciliation_items (
      id INTEGER PRIMARY KEY, reconciliation_id INTEGER NOT NULL
    );
    CREATE TABLE inventory_ledger (
      id INTEGER PRIMARY KEY, organization_id INTEGER NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE troop_inventory_balances (
      id INTEGER PRIMARY KEY, organization_id INTEGER NOT NULL
    );
    CREATE TABLE admin_alerts (id INTEGER PRIMARY KEY, organization_id INTEGER NOT NULL);
    CREATE TABLE booth_lifecycle_audit (
      id INTEGER PRIMARY KEY, organization_id INTEGER NOT NULL
    );
    CREATE TABLE inventory_configuration_audit (
      id INTEGER PRIMARY KEY, organization_id INTEGER NOT NULL
    );
    CREATE TABLE access_audit_log (
      id INTEGER PRIMARY KEY, organization_id INTEGER NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE product_catalog_audit (
      id INTEGER PRIMARY KEY, organization_id INTEGER NOT NULL
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
    INSERT INTO organizations VALUES (1, 'Demo Troop'), (2, 'Neighbor Troop');
    INSERT INTO users VALUES
      (10, '${SUPER_ADMIN_ID}', 'Chris'),
      (11, '${REGULAR_ADMIN_ID}', 'Regular Admin');
    INSERT INTO memberships VALUES
      (1, 1, 10, 'admin'), (2, 1, 11, 'admin'), (3, 2, 11, 'admin');
    INSERT INTO organization_invitations VALUES
      (1, 1, 'demo@example.test'), (2, 2, 'neighbor@example.test');
    INSERT INTO products VALUES
      (1, 1, 'Thin Mints', '111', 6), (2, 2, 'Samoas', '222', 6);
    INSERT INTO booths VALUES (100, 1), (200, 2);
    INSERT INTO assignments VALUES (1, 100), (2, 200);
    INSERT INTO inventory VALUES (1, 100), (2, 200);
    INSERT INTO transactions VALUES (1, 100), (2, 200);
    INSERT INTO sales VALUES
      (1, 100, '2026-01-02T00:00:00.000Z'),
      (2, 100, '2026-01-03T00:00:00.000Z'),
      (3, 200, '2026-01-04T00:00:00.000Z');
    INSERT INTO reconciliations VALUES (1, 100), (2, 200);
    INSERT INTO reconciliation_items VALUES (1, 1), (2, 2);
    INSERT INTO inventory_ledger VALUES
      (1, 1, '2026-01-01T00:00:00.000Z'),
      (2, 1, '2026-01-02T00:00:00.000Z'),
      (3, 2, '2026-01-03T00:00:00.000Z');
    INSERT INTO troop_inventory_balances VALUES (1, 1), (2, 2);
    INSERT INTO admin_alerts VALUES (1, 1), (2, 2);
    INSERT INTO booth_lifecycle_audit VALUES (1, 1), (2, 2);
    INSERT INTO inventory_configuration_audit VALUES (1, 1), (2, 2);
    INSERT INTO access_audit_log VALUES
      (1, 1, '2026-01-04T00:00:00.000Z'),
      (2, 2, '2026-01-05T00:00:00.000Z');
    INSERT INTO product_catalog_audit VALUES (1, 1), (2, 2);
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

function purgeRequest(organizationId = 1) {
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

test("real Super Admin handlers reject a regular organization administrator", async () => {
  reset({ userId: REGULAR_ADMIN_ID });

  assert.equal((await route.GET()).status, 403);
  assert.equal((await route.POST(purgeRequest())).status, 403);
  assert.equal(database.calls, 0, "unauthorized requests must not reach D1");
});

test("GET preview reports accurate organization-scoped counts", async () => {
  reset();

  const response = await route.GET();
  assert.equal(response.status, 200);
  const payload = await response.json();
  const demo = payload.organizations.find(({ id }) => id === 1);
  const neighbor = payload.organizations.find(({ id }) => id === 2);

  assert.deepEqual(
    {
      members: demo.memberCount,
      products: demo.productCount,
      booths: demo.boothCount,
      inventoryTransactions: demo.inventoryTransactionCount,
      sales: demo.salesCount,
      auditEvents: demo.auditCount,
    },
    {
      members: 2,
      products: 1,
      booths: 1,
      inventoryTransactions: 2,
      sales: 2,
      auditEvents: 4,
    },
  );
  assert.equal(neighbor.salesCount, 1);
  assert.equal(neighbor.inventoryTransactionCount, 1);
});

test("POST purges only the selected organization and preserves protected records", async () => {
  reset();

  const response = await route.POST(purgeRequest());
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.deletedCounts, {
    booths: 1,
    inventoryTransactions: 2,
    sales: 2,
    regularAuditEvents: 4,
  });

  for (const table of ["booths", "inventory_ledger", "sales"]) {
    assert.equal(database.count(table, 1), 0, `${table} should be purged`);
    assert.ok(database.count(table, 2) > 0, `${table} for another tenant must survive`);
  }
  for (const table of [
    "memberships",
    "organization_invitations",
    "products",
  ]) {
    assert.ok(database.count(table, 1) > 0, `${table} must be preserved`);
    assert.ok(database.count(table, 2) > 0, `${table} for another tenant must survive`);
  }
  assert.equal(
    database.sqlite.prepare("SELECT COUNT(*) AS count FROM organizations").get().count,
    2,
  );
  assert.equal(
    database.sqlite.prepare("SELECT COUNT(*) AS count FROM users").get().count,
    2,
  );
});

test("successful purge and success audit are committed atomically", async () => {
  reset();

  const response = await route.POST(purgeRequest());
  const payload = await response.json();
  const audit = database.sqlite.prepare(`
    SELECT * FROM super_admin_audit_log
    WHERE outcome = 'success'
  `).get();

  assert.equal(response.status, 200);
  assert.equal(audit.action, "organization_data_purged");
  assert.equal(audit.target_organization_id, 1);
  assert.equal(audit.target_organization_name, "Demo Troop");
  assert.equal(audit.actor_clerk_user_id, SUPER_ADMIN_ID);
  assert.equal(audit.reason, "Integration test");
  assert.equal(audit.request_id, payload.requestId);
  assert.deepEqual(JSON.parse(audit.deleted_counts_json), payload.deletedCounts);
});

test("a batch failure rolls back every deletion and records a failed purge", async () => {
  reset();
  database.failOn = "delete from inventory_ledger";

  const response = await route.POST(purgeRequest());
  const payload = await response.json();
  assert.equal(response.status, 500);
  assert.match(payload.requestId, /^[0-9a-f-]{36}$/);

  assert.equal(database.count("booths", 1), 1);
  assert.equal(database.count("inventory_ledger", 1), 2);
  assert.equal(database.count("sales", 1), 2);
  assert.equal(database.count("memberships", 1), 2);
  assert.equal(database.count("products", 1), 1);

  const audits = database.sqlite.prepare(
    "SELECT * FROM super_admin_audit_log ORDER BY id",
  ).all();
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "organization_data_purge_failed");
  assert.equal(audits[0].outcome, "failure");
  assert.equal(audits[0].target_organization_id, 1);
  assert.equal(audits[0].request_id, payload.requestId);
});
