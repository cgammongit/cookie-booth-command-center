import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const migration = await readFile(new URL("../drizzle/0014_recent_sales_reversal.sql", import.meta.url), "utf8");
const statements = migration.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean);

function database(populated) {
  const db = new DatabaseSync(":memory:");
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE organizations(id INTEGER PRIMARY KEY);
    CREATE TABLE users(id INTEGER PRIMARY KEY);
    CREATE TABLE booths(id INTEGER PRIMARY KEY,organization_id INTEGER NOT NULL,status TEXT,archived_at TEXT);
    CREATE TABLE sales(id TEXT PRIMARY KEY,booth_id INTEGER NOT NULL,created_at TEXT);
    CREATE TABLE reconciliations(id INTEGER PRIMARY KEY,booth_id INTEGER NOT NULL);
    INSERT INTO organizations VALUES(1); INSERT INTO users VALUES(1);
    INSERT INTO booths VALUES(10,1,'live',NULL);
    ${populated ? "INSERT INTO sales VALUES('existing-sale',10,'2026-08-01T00:00:00Z');" : ""}`);
  for (const statement of statements) db.exec(statement);
  return db;
}

test("migration 0014 applies to fresh and populated databases without rewriting sales", () => {
  for (const populated of [false, true]) {
    const db = database(populated);
    assert.equal(db.prepare("SELECT sales_revision FROM booths WHERE id=10").get().sales_revision, 0);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM sale_reversals").get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM sales").get().count, populated ? 1 : 0);
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='sale_reversals_sale_unique'").get());
  }
});

test("migration enforces one reversal and rejects stale reconciliation revisions", () => {
  const db = database(true);
  db.prepare("INSERT INTO sale_reversals VALUES(?,?,?,?,?,?,?,?,?)").run(
    "r1", "existing-sale", 1, 10, 1, "clerk-admin", "duplicate_sale", null, "2026-08-02T00:00:00Z",
  );
  assert.throws(() => db.prepare("INSERT INTO sale_reversals VALUES(?,?,?,?,?,?,?,?,?)").run(
    "r2", "existing-sale", 1, 10, 1, "clerk-admin", "duplicate_sale", null, "2026-08-02T00:00:01Z",
  ));
  db.prepare("UPDATE booths SET sales_revision=1 WHERE id=10").run();
  assert.throws(() => db.prepare("INSERT INTO reconciliations(id,booth_id,sales_revision) VALUES(1,10,0)").run(), /sales changed/);
  db.prepare("INSERT INTO reconciliations(id,booth_id,sales_revision) VALUES(1,10,1)").run();
});
