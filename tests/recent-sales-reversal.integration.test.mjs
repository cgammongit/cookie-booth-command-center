import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const sqlite = new DatabaseSync(":memory:");
sqlite.exec(`PRAGMA foreign_keys=ON;
CREATE TABLE organizations(id INTEGER PRIMARY KEY,name TEXT);
CREATE TABLE users(id INTEGER PRIMARY KEY,clerk_user_id TEXT,email TEXT,display_name TEXT,status TEXT,last_synced_at TEXT);
CREATE TABLE memberships(id INTEGER PRIMARY KEY,organization_id INTEGER,user_id INTEGER,role TEXT,status TEXT,can_invite_users INTEGER,created_at TEXT,updated_at TEXT);
CREATE TABLE assignments(id INTEGER PRIMARY KEY,booth_id INTEGER,user_id INTEGER,role TEXT);
CREATE TABLE booths(id INTEGER PRIMARY KEY,organization_id INTEGER,status TEXT,starts_at TEXT,ends_at TEXT,archived_at TEXT,sales_revision INTEGER NOT NULL DEFAULT 0);
CREATE TABLE products(id INTEGER PRIMARY KEY,organization_id INTEGER,name TEXT);
CREATE TABLE inventory(id INTEGER PRIMARY KEY,booth_id INTEGER,product_id INTEGER,opening INTEGER,sold INTEGER,adjusted INTEGER);
CREATE TABLE troop_inventory_balances(id INTEGER PRIMARY KEY,organization_id INTEGER,product_id INTEGER,total_remaining INTEGER,available INTEGER,updated_at TEXT);
CREATE TABLE sales(id TEXT PRIMARY KEY,booth_id INTEGER,operator_id INTEGER,payment_method TEXT,box_count INTEGER,total_amount REAL,created_at TEXT);
CREATE TABLE transactions(id TEXT PRIMARY KEY,sale_id TEXT,booth_id INTEGER,product_id INTEGER,operator_id INTEGER,type TEXT,quantity INTEGER,amount REAL,reason TEXT,created_at TEXT);
CREATE TABLE reconciliations(id INTEGER PRIMARY KEY,booth_id INTEGER UNIQUE);
CREATE TABLE sale_reversals(id TEXT PRIMARY KEY,sale_id TEXT NOT NULL UNIQUE,organization_id INTEGER NOT NULL,booth_id INTEGER NOT NULL,reversed_by_user_id INTEGER NOT NULL,reversed_by_clerk_user_id TEXT NOT NULL,reason_code TEXT NOT NULL,reason_detail TEXT,reversed_at TEXT NOT NULL);
CREATE TABLE inventory_ledger(id INTEGER PRIMARY KEY AUTOINCREMENT,organization_id INTEGER,product_id INTEGER,booth_id INTEGER,actor_user_id INTEGER,movement_type TEXT,total_delta INTEGER,available_delta INTEGER,booth_delta INTEGER,reason TEXT,reference TEXT,created_at TEXT);
INSERT INTO organizations VALUES(1,'One'),(2,'Two');
INSERT INTO users VALUES(1,'clerk-admin','a@test','Admin One','active',''),(2,'clerk-vol','v@test','Volunteer','active',''),(3,'clerk-other','o@test','Other Admin','active','');
INSERT INTO memberships VALUES(1,1,1,'admin','active',0,'',''),(2,1,2,'volunteer','active',0,'',''),(3,2,3,'admin','active',0,'','');
INSERT INTO booths VALUES(10,1,'live','2026-08-01T00:00:00Z','2026-08-10T00:00:00Z',NULL,0),(20,2,'live','2026-08-01T00:00:00Z','2026-08-10T00:00:00Z',NULL,0);
INSERT INTO assignments VALUES(1,10,2,'volunteer');
INSERT INTO products VALUES(100,1,'Mints'),(101,1,'Caramel'),(200,2,'Other');
INSERT INTO inventory VALUES(1,10,100,20,10,0),(2,10,101,20,2,0),(3,20,200,20,1,0);
INSERT INTO troop_inventory_balances VALUES(1,1,100,10,0,''),(2,1,101,18,0,''),(3,2,200,19,0,'');
`);

const saleIds = Array.from({ length: 7 }, (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);
for (let index = 0; index < saleIds.length; index += 1) {
  sqlite.prepare("INSERT INTO sales VALUES(?,10,1,?,1,6,?)").run(saleIds[index], index % 3 === 0 ? "cash" : index % 3 === 1 ? "credit_card" : "venmo_paypal", `2026-08-03T12:0${index}:00Z`);
  sqlite.prepare("INSERT INTO transactions VALUES(?,?,10,100,1,'sale',1,6,NULL,?)").run(`t${index}`, saleIds[index], `2026-08-03T12:0${index}:00Z`);
}
const multiSale = "11111111-1111-4111-8111-111111111111";
sqlite.prepare("INSERT INTO sales VALUES(?,10,1,'cash',5,30,'2026-08-03T13:00:00Z')").run(multiSale);
sqlite.prepare("INSERT INTO transactions VALUES('tm1',?,10,100,1,'sale',3,18,NULL,'2026-08-03T13:00:00Z'),('tm2',?,10,101,1,'sale',2,12,NULL,'2026-08-03T13:00:00Z')").run(multiSale,multiSale);

globalThis.__CLERK_TEST_AUTH__ = { userId: "clerk-admin" };
function norm(sql) { return sql.replace(/\s+/g, " ").trim().toLowerCase(); }
class Statement {
  constructor(sql) { this.sql=sql; this.params=[]; }
  bind(...params){this.params=params;return this;}
  async raw(){const sql=norm(this.sql);if(sql.includes('from "users" inner join "memberships"')){const clerk=globalThis.__CLERK_TEST_AUTH__?.userId;const organizationId=this.params.find((value)=>typeof value==='number');const row=sqlite.prepare('SELECT u.id,m.id membership_id,m.organization_id,m.role,m.status,m.can_invite_users FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.clerk_user_id=? AND m.organization_id=? AND u.status=\'active\' AND m.status=\'active\'').get(clerk,organizationId);return row?[[row.id,row.membership_id,row.organization_id,row.role,row.status,Boolean(row.can_invite_users)]]:[];}if(sql.includes('from "booths"')&&!sql.includes(' join ')){const row=sqlite.prepare('SELECT id,organization_id,status,archived_at FROM booths WHERE id=?').get(this.params[0]);return row?[[row.id,row.organization_id,row.status,row.archived_at]]:[];}if(sql.includes('from "assignments"')){const row=sqlite.prepare('SELECT role FROM assignments WHERE booth_id=? AND user_id=?').get(...this.params.slice(0,2));return row?[[row.role]]:[];}throw new Error(`raw ${sql}`);}
  async first(){return sqlite.prepare(this.sql).get(...this.params)??null;}
  async all(){return{results:sqlite.prepare(this.sql).all(...this.params),success:true,meta:{}};}
  async run(){const result=sqlite.prepare(this.sql).run(...this.params);return{success:true,meta:{changes:Number(result.changes),last_row_id:Number(result.lastInsertRowid)}};}
}
class DB { constructor(){this.queue=Promise.resolve();} prepare(sql){return new Statement(sql);} batch(statements){const operation=this.queue.then(async()=>{sqlite.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}});this.queue=operation.catch(()=>undefined);return operation;} }
globalThis.__CLOUDFLARE_ENV__={DB:new DB(),BOOTH_LIVE_ROOMS:{getByName(){return{fetch:async()=>new Response(null,{status:204})};}}};
const salesRoute=await import('../app/api/booths/[boothId]/sales/route.ts');
const reversalRoute=await import('../app/api/booths/[boothId]/sales/[saleId]/reversal/route.ts');
const context=(boothId,saleId)=>({params:Promise.resolve({boothId:String(boothId),saleId})});

test('recent sales uses the actual handler, limits to five, and orders deterministically',async()=>{
  const response=await salesRoute.GET(new Request('https://app.test'),context(10));
  assert.equal(response.status,200);const body=await response.json();assert.equal(body.sales.length,5);
  assert.equal(body.sales[0].id,multiSale);assert.equal(body.permissions.canReverseSales,true);
  assert.deepEqual(body.sales[0].items.map((item)=>[item.name,item.quantity]),[['Caramel',2],['Mints',3]]);
});

test('volunteers may view but cannot reverse through the actual server boundary',async()=>{
  globalThis.__CLERK_TEST_AUTH__={userId:'clerk-vol'};
  const view=await salesRoute.GET(new Request('https://app.test'),context(10));assert.equal(view.status,200);assert.equal((await view.json()).permissions.canReverseSales,false);
  const denied=await reversalRoute.POST(new Request('https://app.test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({reasonCode:'duplicate_sale'})}),context(10,multiSale));
  assert.equal(denied.status,403);assert.equal(sqlite.prepare('SELECT COUNT(*) count FROM sale_reversals').get().count,0);
  globalThis.__CLERK_TEST_AUTH__={userId:'clerk-admin'};
});

test('administrator reversal is atomic, exact, auditable, and idempotent',async()=>{
  const request=()=>reversalRoute.POST(new Request('https://app.test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({reasonCode:'wrong_cookies'})}),context(10,multiSale));
  const response=await request();assert.equal(response.status,201);
  assert.equal(sqlite.prepare('SELECT COUNT(*) count FROM sales WHERE id=?').get(multiSale).count,1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) count FROM sale_reversals WHERE sale_id=?').get(multiSale).count,1);
  assert.deepEqual(sqlite.prepare('SELECT product_id,sold FROM inventory WHERE booth_id=10 ORDER BY product_id').all().map(row=>({...row})),[{product_id:100,sold:7},{product_id:101,sold:0}]);
  assert.deepEqual(sqlite.prepare('SELECT product_id,total_remaining FROM troop_inventory_balances WHERE organization_id=1 ORDER BY product_id').all().map(row=>({...row})),[{product_id:100,total_remaining:13},{product_id:101,total_remaining:20}]);
  assert.equal(sqlite.prepare("SELECT COUNT(*) count FROM inventory_ledger WHERE reference LIKE 'sale-reversal:%'").get().count,2);
  assert.equal((await request()).status,409);
  assert.equal(sqlite.prepare('SELECT COUNT(*) count FROM sale_reversals WHERE sale_id=?').get(multiSale).count,1);
  const recent=await (await salesRoute.GET(new Request('https://app.test'),context(10))).json();assert.equal(recent.sales.length,5);assert.ok(!recent.sales.some(sale=>sale.id===multiSale));
});

test('cross-organization and malformed reversal requests fail without effects',async()=>{
  const before=sqlite.prepare('SELECT COUNT(*) count FROM sale_reversals').get().count;
  assert.equal((await reversalRoute.POST(new Request('https://app.test',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),context(10,'bad'))).status,400);
  globalThis.__CLERK_TEST_AUTH__={userId:'clerk-other'};
  assert.equal((await salesRoute.GET(new Request('https://app.test'),context(10))).status,403);
  assert.equal(sqlite.prepare('SELECT COUNT(*) count FROM sale_reversals').get().count,before);
  globalThis.__CLERK_TEST_AUTH__={userId:'clerk-admin'};
});

test('concurrent reversal attempts serialize to one success and one conflict',async()=>{
  const saleId=saleIds[6];
  const request=()=>reversalRoute.POST(new Request('https://app.test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({reasonCode:'duplicate_sale'})}),context(10,saleId));
  const beforeSold=sqlite.prepare('SELECT sold FROM inventory WHERE booth_id=10 AND product_id=100').get().sold;
  const beforeTotal=sqlite.prepare('SELECT total_remaining FROM troop_inventory_balances WHERE organization_id=1 AND product_id=100').get().total_remaining;
  const responses=await Promise.all([request(),request()]);
  assert.deepEqual(responses.map(response=>response.status).sort(),[201,409]);
  assert.equal(sqlite.prepare('SELECT COUNT(*) count FROM sale_reversals WHERE sale_id=?').get(saleId).count,1);
  assert.equal(sqlite.prepare('SELECT sold FROM inventory WHERE booth_id=10 AND product_id=100').get().sold,beforeSold-1);
  assert.equal(sqlite.prepare('SELECT total_remaining FROM troop_inventory_balances WHERE organization_id=1 AND product_id=100').get().total_remaining,beforeTotal+1);
});

test('cash, credit card, and Venmo/PayPal totals each exclude only their reversed sale',async()=>{
  for (const [saleId,paymentMethod] of [[saleIds[0],'cash'],[saleIds[1],'credit_card'],[saleIds[2],'venmo_paypal']]) {
    const activeTotal=()=>Number(sqlite.prepare(`SELECT COALESCE(SUM(s.total_amount),0) total FROM sales s WHERE s.booth_id=10 AND s.payment_method=? AND NOT EXISTS(SELECT 1 FROM sale_reversals r WHERE r.sale_id=s.id)`).get(paymentMethod).total);
    const before=activeTotal();
    const response=await reversalRoute.POST(new Request('https://app.test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({reasonCode:'wrong_payment_method'})}),context(10,saleId));
    assert.equal(response.status,201);assert.equal(activeTotal(),before-6);
    assert.equal(sqlite.prepare('SELECT reason_code FROM sale_reversals WHERE sale_id=?').get(saleId).reason_code,'wrong_payment_method');
  }
});
