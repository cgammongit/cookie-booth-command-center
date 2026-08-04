import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const sqlite = new DatabaseSync(":memory:");
sqlite.exec(`
 CREATE TABLE organizations(id INTEGER PRIMARY KEY,name TEXT);
 CREATE TABLE users(id INTEGER PRIMARY KEY,clerk_user_id TEXT,email TEXT,display_name TEXT,status TEXT,last_synced_at TEXT);
 CREATE TABLE memberships(id INTEGER PRIMARY KEY,organization_id INTEGER,user_id INTEGER,role TEXT,status TEXT,can_invite_users INTEGER,created_at TEXT,updated_at TEXT);
 CREATE TABLE booths(id INTEGER PRIMARY KEY,organization_id INTEGER,name TEXT,starts_at TEXT,status TEXT,archived_at TEXT);
 CREATE TABLE sales(id TEXT PRIMARY KEY,booth_id INTEGER,operator_id INTEGER,payment_method TEXT,box_count INTEGER,total_amount REAL,created_at TEXT);
 CREATE TABLE sale_reversals(id TEXT PRIMARY KEY,sale_id TEXT UNIQUE);
 CREATE TABLE transactions(id TEXT PRIMARY KEY,sale_id TEXT,booth_id INTEGER,product_id INTEGER,operator_id INTEGER,type TEXT,quantity INTEGER,amount REAL,reason TEXT,created_at TEXT);
 CREATE TABLE products(id INTEGER PRIMARY KEY,organization_id INTEGER,name TEXT,barcode TEXT,price REAL,active INTEGER,updated_at TEXT);
 CREATE TABLE reconciliations(id INTEGER PRIMARY KEY,booth_id INTEGER,closed_by INTEGER,cash_total REAL,expected_cash_total REAL,cash_discrepancy REAL,digital_total REAL,credit_card_total REAL,venmo_paypal_total REAL,gross_total REAL,expected_box_count INTEGER,actual_box_count INTEGER,inventory_discrepancy_count INTEGER,notes TEXT,closed_at TEXT);
 CREATE TABLE scouts(id INTEGER PRIMARY KEY,organization_id INTEGER,name TEXT,age_level TEXT,archived_at TEXT,created_at TEXT,updated_at TEXT);
 CREATE TABLE scout_sales_credits(id INTEGER PRIMARY KEY,organization_id INTEGER,booth_id INTEGER,sale_id TEXT,transaction_id TEXT,scout_id INTEGER,reconciliation_id INTEGER,credit_numerator INTEGER,credit_denominator INTEGER,finalized_at TEXT);
 INSERT INTO organizations VALUES(1,'Troop One'),(2,'Troop Two');
 INSERT INTO users VALUES(1,'clerk-report','a@test','Admin','active','');
 INSERT INTO memberships VALUES(1,1,1,'admin','active',0,'','');
 INSERT INTO booths VALUES(10,1,'First Booth','2026-01-01','closed',NULL),(20,1,'Second Booth','2026-02-01','closed',NULL),(30,2,'Other Booth','2026-01-01','closed',NULL);
 INSERT INTO products VALUES(100,1,'Mints','M',6,1,''),(101,1,'Caramel','C',6,1,''),(200,2,'Other','O',6,1,'');
 INSERT INTO scouts VALUES(50,1,'Scout One','Junior',NULL,'',''),(51,1,'Scout Archived','Brownie','2026-03-01','',''),(60,2,'Other Scout','Senior',NULL,'','');
 INSERT INTO sales VALUES('s1',10,1,'cash',5,30,'2026-01-01T18:00:00Z'),('s2',20,1,'cash',3,18,'2026-02-01T18:00:00Z'),('s3',30,1,'cash',9,54,'2026-01-01T18:00:00Z');
 INSERT INTO transactions VALUES('t1','s1',10,100,1,'sale',5,30,NULL,'2026-01-01T18:00:00Z'),('t2','s2',20,101,1,'sale',3,18,NULL,'2026-02-01T18:00:00Z'),('t3','s3',30,200,1,'sale',9,54,NULL,'2026-01-01T18:00:00Z');
 INSERT INTO reconciliations VALUES(1,10,1,30,30,0,0,0,0,30,0,0,0,NULL,'2026-01-02'),(2,20,1,18,18,0,0,0,0,18,0,0,0,NULL,'2026-02-02'),(3,30,1,54,54,0,0,0,0,54,0,0,0,NULL,'2026-01-02');
 INSERT INTO scout_sales_credits VALUES(1,1,10,'s1','t1',50,1,5,2,'2026-01-02'),(2,1,10,'s1','t1',51,1,5,2,'2026-01-02'),(3,1,20,'s2','t2',50,2,3,1,'2026-02-02'),(4,2,30,'s3','t3',60,3,9,1,'2026-01-02');
`);
globalThis.__CLERK_TEST_AUTH__ = { userId: "clerk-report" };
function normalize(sql) { return sql.replace(/\s+/g, " ").trim().toLowerCase(); }
class Statement {
 constructor(sql) { this.sql=sql; this.params=[]; }
 bind(...params){this.params=params;return this;}
 async raw(){ if(normalize(this.sql).includes('from "users" inner join "memberships"')) return [[1,1,1,'admin','active',false]]; return []; }
 async all(){return {results:sqlite.prepare(this.sql).all(...this.params),success:true,meta:{}};}
 async first(){return sqlite.prepare(this.sql).get(...this.params)??null;}
}
globalThis.__CLOUDFLARE_ENV__={DB:{prepare(sql){return new Statement(sql);}}};
const route=await import("../app/api/reports/booth-sales/route.ts");

test("actual report handler totals finalized fractional credit across booths and retains archived scouts",async()=>{
 const response=await route.GET(new Request("https://app.test/api/reports/booth-sales?organizationId=1&boothIds=10,20"));
 assert.equal(response.status,200); const payload=await response.json();
 assert.deepEqual(payload.report.scoutSales.map(({scoutName,creditedBoxes,reconciledBooths,archived})=>({scoutName,creditedBoxes,reconciledBooths,archived})),[
  {scoutName:"Scout Archived",creditedBoxes:2.5,reconciledBooths:1,archived:true},
  {scoutName:"Scout One",creditedBoxes:5.5,reconciledBooths:2,archived:false},
 ]);
 assert.equal(payload.report.scoutSales.some((scout)=>scout.scoutName==="Other Scout"),false);
});

test("actual report handler rejects selected booths outside the authenticated organization",async()=>{
 const response=await route.GET(new Request("https://app.test/api/reports/booth-sales?organizationId=1&boothIds=30"));
 assert.equal(response.status,403);
});

test("actual report handler excludes a reversed sale and its finalized credit defensively",async()=>{
 sqlite.prepare("INSERT INTO sale_reversals VALUES('r-s2','s2')").run();
 try {
  const response=await route.GET(new Request("https://app.test/api/reports/booth-sales?organizationId=1&boothIds=10,20"));
  assert.equal(response.status,200); const payload=await response.json();
  const scout=payload.report.scoutSales.find((item)=>item.scoutName==="Scout One");
  assert.equal(scout.creditedBoxes,2.5); assert.equal(scout.reconciledBooths,1);
  const booth=payload.report.boothSales.find((item)=>Number(item.boothId)===20);
  assert.equal(Number(booth.gross),0); assert.equal(Number(booth.boxCount),0);
 } finally { sqlite.prepare("DELETE FROM sale_reversals WHERE id='r-s2'").run(); }
});
