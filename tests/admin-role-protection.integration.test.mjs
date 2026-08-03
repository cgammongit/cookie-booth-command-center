import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const OWNER_CLERK_ID = "clerk-owner";
const ORDINARY_ADMIN_CLERK_ID = "clerk-ordinary-admin";
const LONE_ADMIN_CLERK_ID = "clerk-lone-admin";

globalThis.__CLERK_TEST_AUTH__ = { userId: ORDINARY_ADMIN_CLERK_ID };

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

  async raw() {
    const statement = this.database.sqlite.prepare(this.sql);
    statement.setReturnArrays(true);
    return statement.all(...this.params);
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
    this.sqlite.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        clerk_user_id TEXT UNIQUE,
        email TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        status TEXT NOT NULL,
        last_synced_at TEXT NOT NULL
      );
      CREATE TABLE memberships (
        id INTEGER PRIMARY KEY,
        organization_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        role TEXT NOT NULL,
        status TEXT NOT NULL,
        can_invite_users INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (organization_id, user_id),
        FOREIGN KEY (user_id) REFERENCES users(id)
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

      INSERT INTO users VALUES
        (10, '${OWNER_CLERK_ID}', 'CGammon2014@GMAIL.COM', 'Owner', 'active', '2026-08-01'),
        (11, '${ORDINARY_ADMIN_CLERK_ID}', 'ordinary@example.test', 'Ordinary Admin', 'active', '2026-08-01'),
        (12, 'clerk-target-admin', 'target@example.test', 'Target Admin', 'active', '2026-08-01'),
        (13, 'clerk-member', 'member@example.test', 'Member', 'active', '2026-08-01'),
        (20, 'clerk-other-admin', 'other@example.test', 'Other Admin', 'active', '2026-08-01'),
        (30, '${LONE_ADMIN_CLERK_ID}', 'lone@example.test', 'Lone Admin', 'active', '2026-08-01');

      INSERT INTO memberships VALUES
        (100, 1, 10, 'admin', 'active', 0, '2026-08-01', '2026-08-01'),
        (101, 1, 11, 'admin', 'active', 0, '2026-08-01', '2026-08-01'),
        (102, 1, 12, 'admin', 'active', 0, '2026-08-01', '2026-08-01'),
        (103, 1, 13, 'volunteer', 'active', 0, '2026-08-01', '2026-08-01'),
        (200, 2, 20, 'admin', 'active', 0, '2026-08-01', '2026-08-01'),
        (300, 3, 30, 'admin', 'active', 0, '2026-08-01', '2026-08-01');
    `);
  }

  prepare(sql) {
    return new D1Statement(this, sql);
  }

  async batch(statements) {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

globalThis.__CLOUDFLARE_ENV__ = {
  DB: new TransactionalD1(),
  SUPER_ADMIN_CLERK_USER_IDS: OWNER_CLERK_ID,
};

const route = await import("../app/api/admin/people/[membershipId]/route.ts");
const protection = await import("../lib/admin-role-protection.ts");

function reset(actorClerkId = ORDINARY_ADMIN_CLERK_ID) {
  globalThis.__CLOUDFLARE_ENV__.DB = new TransactionalD1();
  globalThis.__CLERK_TEST_AUTH__.userId = actorClerkId;
}

function membership(id) {
  return globalThis.__CLOUDFLARE_ENV__.DB.sqlite
    .prepare("SELECT * FROM memberships WHERE id = ?")
    .get(id);
}

function auditCount() {
  return Number(
    globalThis.__CLOUDFLARE_ENV__.DB.sqlite
      .prepare("SELECT COUNT(*) AS count FROM access_audit_log")
      .get().count,
  );
}

function patchMembership(
  membershipId,
  body,
) {
  return route.PATCH(
    new Request(`https://app.example/api/admin/people/${membershipId}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin: "https://app.example",
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ membershipId: String(membershipId) }) },
  );
}

function state(organizationId, role, status, extra = {}) {
  return { organizationId, role, status, canInviteUsers: false, ...extra };
}

test("ordinary administrators cannot demote another administrator", async () => {
  reset();
  const before = membership(102);
  const response = await patchMembership(102, state(1, "lead", "active"));
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: "Administrators cannot reduce another administrator's access",
  });
  assert.deepEqual(membership(102), before);
  assert.equal(auditCount(), 0);
});

test("ordinary administrators cannot suspend or deactivate another administrator", async () => {
  for (const status of ["suspended", "pending"]) {
    reset();
    const before = membership(102);
    const response = await patchMembership(102, state(1, "admin", status));
    assert.equal(response.status, 403, status);
    assert.deepEqual(membership(102), before, status);
    assert.equal(auditCount(), 0, status);
  }
});

test("direct requests and forged request-body email cannot grant the override", async () => {
  reset();
  const before = membership(102);
  const response = await patchMembership(
    102,
    state(1, "lead", "active", { email: "cgammon2014@gmail.com" }),
  );
  assert.equal(response.status, 400);
  assert.deepEqual(membership(102), before);
  assert.equal(auditCount(), 0);
});

test("the server-verified override account can manage roles and member status", async () => {
  reset(OWNER_CLERK_ID);
  assert.equal(
    (await patchMembership(102, state(1, "lead", "active"))).status,
    200,
  );
  assert.equal(membership(102).role, "lead");

  assert.equal(
    (await patchMembership(103, state(1, "admin", "active"))).status,
    200,
  );
  assert.equal(membership(103).role, "admin");

  assert.equal(
    (await patchMembership(103, state(1, "volunteer", "suspended"))).status,
    200,
  );
  assert.equal(membership(103).status, "suspended");
  assert.equal(
    (await patchMembership(103, state(1, "volunteer", "active"))).status,
    200,
  );
  assert.equal(membership(103).status, "active");
  assert.ok(auditCount() >= 4);
});

test("an allowlisted Clerk ID with a different synchronized email fails closed", async () => {
  reset(OWNER_CLERK_ID);
  globalThis.__CLOUDFLARE_ENV__.DB.sqlite
    .prepare("UPDATE users SET email = ? WHERE clerk_user_id = ?")
    .run("different@example.test", OWNER_CLERK_ID);
  const before = membership(102);
  const response = await patchMembership(102, state(1, "lead", "active"));
  assert.equal(response.status, 403);
  assert.deepEqual(membership(102), before);
  assert.equal(auditCount(), 0);
});

test("the override identity does not bypass organization membership", async () => {
  reset(OWNER_CLERK_ID);
  const before = membership(200);
  const response = await patchMembership(200, state(2, "lead", "active"));
  assert.equal(response.status, 403);
  assert.deepEqual(membership(200), before);
  assert.equal(auditCount(), 0);
});

test("the last active administrator protection remains authoritative", async () => {
  reset(LONE_ADMIN_CLERK_ID);
  const before = membership(300);
  const response = await patchMembership(300, state(3, "lead", "active"));
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "The organization must retain at least one active administrator",
  });
  assert.deepEqual(membership(300), before);
  assert.equal(auditCount(), 0);
});

test("self-demotion remains available when another active administrator remains", async () => {
  reset();
  const response = await patchMembership(101, state(1, "lead", "active"));
  assert.equal(response.status, 200);
  assert.equal(membership(101).role, "lead");
});

test("interface protection distinguishes other administrators and override actors", () => {
  assert.equal(
    protection.isAdministratorProtectedFromActor({
      actorUserId: 11,
      targetUserId: 12,
      targetRole: "admin",
      actorMayManageProtectedAdministrators: false,
    }),
    true,
  );
  assert.equal(
    protection.isAdministratorProtectedFromActor({
      actorUserId: 10,
      targetUserId: 12,
      targetRole: "admin",
      actorMayManageProtectedAdministrators: true,
    }),
    false,
  );
  assert.equal(
    protection.isAdministratorProtectedFromActor({
      actorUserId: 11,
      targetUserId: 11,
      targetRole: "admin",
      actorMayManageProtectedAdministrators: false,
    }),
    false,
  );
});
