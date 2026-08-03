import assert from "node:assert/strict";
import test from "node:test";

const actor = { clerkUserId: "clerk-admin", userId: 10, membershipId: 20, organizationId: 1, role: "admin", status: "active", canInviteUsers: false };
const scouts = new Map(); let nextId = 1;
globalThis.__CLERK_TEST_AUTH__ = { userId: actor.clerkUserId };
function sqlText(sql) { return sql.replace(/\s+/g, " ").trim().toLowerCase(); }
class Statement {
  constructor(sql) { this.sql = sql; this.params = []; }
  bind(...params) { this.params = params; return this; }
  async raw() {
    if (sqlText(this.sql).includes('from "users" inner join "memberships"') && Number(this.params[0]) === actor.organizationId && this.params.includes(actor.clerkUserId)) return [[actor.userId, actor.membershipId, actor.organizationId, actor.role, actor.status, actor.canInviteUsers]];
    return [];
  }
  async all() {
    if (sqlText(this.sql).includes("from scouts where organization_id")) return { results: [...scouts.values()].filter((scout) => scout.organizationId === Number(this.params[0])).map((scout) => ({ id: scout.id, name: scout.name, ageLevel: scout.ageLevel, archivedAt: scout.archivedAt, createdAt: scout.createdAt, updatedAt: scout.updatedAt })) };
    throw new Error(`Unexpected all query: ${sqlText(this.sql)}`);
  }
  async first() {
    if (sqlText(this.sql).includes("from scouts where id = ? and organization_id = ?")) {
      const scout = scouts.get(Number(this.params[0]));
      return scout?.organizationId === Number(this.params[1]) ? { id: scout.id, archivedAt: scout.archivedAt } : null;
    }
    throw new Error(`Unexpected first query: ${sqlText(this.sql)}`);
  }
  async run() {
    const sql = sqlText(this.sql);
    if (sql.startsWith("insert into scouts")) {
      const [organizationId, name, ageLevel, createdAt, updatedAt] = this.params;
      if ([...scouts.values()].some((scout) => scout.organizationId === organizationId && scout.name.toLowerCase() === String(name).toLowerCase())) throw new Error("UNIQUE constraint failed");
      const id = nextId++; scouts.set(id, { id, organizationId, name, ageLevel, archivedAt: null, createdAt, updatedAt });
      return { success: true, meta: { last_row_id: id, changes: 1 } };
    }
    if (sql.startsWith("update scouts")) {
      const [name, ageLevel, archivedAt, updatedAt, id, organizationId] = this.params;
      const scout = scouts.get(Number(id)); if (!scout || scout.organizationId !== Number(organizationId)) return { success: true, meta: { changes: 0 } };
      scouts.set(Number(id), { ...scout, name, ageLevel, archivedAt, updatedAt }); return { success: true, meta: { changes: 1 } };
    }
    throw new Error(`Unexpected run query: ${sql}`);
  }
}
globalThis.__CLOUDFLARE_ENV__ = { DB: { prepare(sql) { return new Statement(sql); } } };
const collection = await import("../app/api/admin/scouts/route.ts");
const item = await import("../app/api/admin/scouts/[scoutId]/route.ts");
function json(method, body) { return new Request("https://app.example/api/admin/scouts", { method, headers: { "content-type": "application/json", origin: "https://app.example" }, body: JSON.stringify(body) }); }

test("actual scout handlers create, list, edit, archive, and restore organization records", async () => {
  const created = await collection.POST(json("POST", { organizationId: 1, name: "Scout Alpha", ageLevel: "Brownie" }));
  assert.equal(created.status, 201);
  const listed = await collection.GET(new Request("https://app.example/api/admin/scouts?organizationId=1"));
  assert.equal((await listed.json()).scouts[0].name, "Scout Alpha");
  const context = { params: Promise.resolve({ scoutId: "1" }) };
  assert.equal((await item.PATCH(json("PATCH", { organizationId: 1, name: "Scout Alpha Updated", ageLevel: "Junior", archived: true }), context)).status, 200);
  assert.ok(scouts.get(1).archivedAt);
  assert.equal((await item.PATCH(json("PATCH", { organizationId: 1, name: "Scout Alpha Updated", ageLevel: "Junior", archived: false }), context)).status, 200);
  assert.equal(scouts.get(1).archivedAt, null);
});

test("actual scout handler rejects invalid levels, duplicates, unauthorized roles, and cross-tenant IDs", async () => {
  assert.equal((await collection.POST(json("POST", { organizationId: 1, name: "Bad Level", ageLevel: "Cadet" }))).status, 400);
  assert.equal((await collection.POST(json("POST", { organizationId: 1, name: "scout alpha updated", ageLevel: "Junior" }))).status, 409);
  actor.role = "volunteer";
  assert.equal((await collection.POST(json("POST", { organizationId: 1, name: "Blocked", ageLevel: "Daisy" }))).status, 403);
  actor.role = "admin";
  assert.equal((await item.PATCH(json("PATCH", { organizationId: 2, name: "Cross", ageLevel: "Senior", archived: false }), { params: Promise.resolve({ scoutId: "1" }) })).status, 403);
});
