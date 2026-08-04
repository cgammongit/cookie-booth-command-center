import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const sqlite=new DatabaseSync(":memory:");
sqlite.exec(`PRAGMA foreign_keys=ON;
CREATE TABLE users(id INTEGER PRIMARY KEY,clerk_user_id TEXT,email TEXT,display_name TEXT,status TEXT,last_synced_at TEXT);
CREATE TABLE memberships(id INTEGER PRIMARY KEY,organization_id INTEGER,user_id INTEGER,role TEXT,status TEXT,can_invite_users INTEGER,created_at TEXT,updated_at TEXT);
CREATE TABLE assignments(id INTEGER PRIMARY KEY,booth_id INTEGER,user_id INTEGER,role TEXT);
CREATE TABLE booths(id INTEGER PRIMARY KEY,organization_id INTEGER,status TEXT,starts_at TEXT,ends_at TEXT,archived_at TEXT,sales_revision INTEGER NOT NULL DEFAULT 0);
CREATE TABLE products(id INTEGER PRIMARY KEY,organization_id INTEGER,name TEXT);
CREATE TABLE inventory(id INTEGER PRIMARY KEY,booth_id INTEGER,product_id INTEGER,opening INTEGER,sold INTEGER,adjusted INTEGER);
CREATE TABLE sales(id TEXT PRIMARY KEY,booth_id INTEGER,operator_id INTEGER,payment_method TEXT,box_count INTEGER,total_amount REAL,created_at TEXT);
CREATE TABLE sale_reversals(id TEXT PRIMARY KEY,sale_id TEXT UNIQUE);
CREATE TABLE transactions(id TEXT PRIMARY KEY,sale_id TEXT,booth_id INTEGER,product_id INTEGER,operator_id INTEGER,type TEXT,quantity INTEGER,amount REAL,reason TEXT,created_at TEXT);
CREATE TABLE scouts(id INTEGER PRIMARY KEY,organization_id INTEGER,name TEXT,age_level TEXT,archived_at TEXT,created_at TEXT,updated_at TEXT);
CREATE TABLE booth_scout_assignments(id INTEGER PRIMARY KEY,organization_id INTEGER,booth_id INTEGER,scout_id INTEGER,attendance_start TEXT,attendance_end TEXT,stayed_through_close INTEGER,created_at TEXT,updated_at TEXT);
CREATE TABLE reconciliations(id INTEGER PRIMARY KEY,booth_id INTEGER UNIQUE,closed_by INTEGER,cash_total REAL,expected_cash_total REAL,cash_discrepancy REAL,digital_total REAL,credit_card_total REAL,venmo_paypal_total REAL,gross_total REAL,expected_box_count INTEGER,actual_box_count INTEGER,inventory_discrepancy_count INTEGER,notes TEXT,closed_at TEXT,sales_revision INTEGER NOT NULL DEFAULT 0);
CREATE TABLE reconciliation_items(id INTEGER PRIMARY KEY AUTOINCREMENT,reconciliation_id INTEGER,product_id INTEGER,expected_remaining INTEGER,actual_remaining INTEGER,discrepancy INTEGER,returned_to_troop INTEGER);
CREATE TABLE troop_inventory_balances(id INTEGER PRIMARY KEY,organization_id INTEGER,product_id INTEGER,total_remaining INTEGER,available INTEGER,updated_at TEXT);
CREATE TABLE inventory_ledger(id INTEGER PRIMARY KEY AUTOINCREMENT,organization_id INTEGER,product_id INTEGER,booth_id INTEGER,actor_user_id INTEGER,movement_type TEXT,total_delta INTEGER,available_delta INTEGER,booth_delta INTEGER,reason TEXT,reference TEXT,created_at TEXT);
CREATE TABLE scout_sales_credits(id INTEGER PRIMARY KEY AUTOINCREMENT,organization_id INTEGER,booth_id INTEGER,sale_id TEXT,transaction_id TEXT,scout_id INTEGER,reconciliation_id INTEGER,credit_numerator INTEGER,credit_denominator INTEGER,finalized_at TEXT,UNIQUE(transaction_id,scout_id));
INSERT INTO users VALUES(1,'clerk-lead','lead@test','Lead','active',''); INSERT INTO memberships VALUES(1,1,1,'lead','active',0,'','');
INSERT INTO booths VALUES(10,1,'live','2026-01-01T18:00:00.000Z','2026-01-01T20:00:00.000Z',NULL,0),(20,1,'live','2026-01-01T18:00:00.000Z','2026-01-01T20:00:00.000Z',NULL,0);
INSERT INTO assignments VALUES(1,10,1,'lead'),(2,20,1,'lead'); INSERT INTO products VALUES(100,1,'Mints');
INSERT INTO inventory VALUES(1,10,100,5,5,0),(2,20,100,1,1,0); INSERT INTO troop_inventory_balances VALUES(1,1,100,100,95,'');
INSERT INTO scouts VALUES(50,1,'One','Junior',NULL,'',''),(51,1,'Two','Cadette',NULL,'','');
INSERT INTO booth_scout_assignments VALUES(1,1,10,50,'2026-01-01T18:00:00.000Z','2026-01-01T20:00:00.000Z',1,'',''),(2,1,10,51,'2026-01-01T18:00:00.000Z','2026-01-01T20:00:00.000Z',1,'','');
INSERT INTO sales VALUES('s1',10,1,'cash',5,30,'2026-01-01T19:00:00.000Z'),('s2',20,1,'cash',1,6,'2026-01-01T19:00:00.000Z');
INSERT INTO transactions VALUES('t1','s1',10,100,1,'sale',5,30,NULL,'2026-01-01T19:00:00.000Z'),('t2','s2',20,100,1,'sale',1,6,NULL,'2026-01-01T19:00:00.000Z');`);
globalThis.__CLERK_TEST_AUTH__={userId:'clerk-lead'};
function norm(sql){return sql.replace(/\s+/g,' ').trim().toLowerCase();}
class Statement{constructor(sql){this.sql=sql;this.params=[];}bind(...p){this.params=p;return this;}async raw(){const sql=norm(this.sql);if(sql.includes('from "users" inner join "memberships"'))return[[1,1,1,'lead','active',false]];if(sql.includes('from "booths"')&&!sql.includes(' join ')){const row=sqlite.prepare('SELECT id,organization_id,status,archived_at FROM booths WHERE id=?').get(this.params[0]);return row?[[row.id,row.organization_id,row.status,row.archived_at]]:[];}if(sql.includes('from "assignments"'))return[['lead']];throw new Error(`raw ${sql}`);}async first(){return sqlite.prepare(this.sql).get(...this.params)??null;}async all(){return{results:sqlite.prepare(this.sql).all(...this.params),success:true,meta:{}};}async run(){const result=sqlite.prepare(this.sql).run(...this.params);return{success:true,meta:{changes:Number(result.changes),last_row_id:Number(result.lastInsertRowid)}};}}
class DB{prepare(sql){return new Statement(sql);}async batch(statements){sqlite.exec('BEGIN');try{const result=[];for(const statement of statements)result.push(await statement.run());sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}}}
globalThis.__CLOUDFLARE_ENV__={DB:new DB(),BOOTH_LIVE_ROOMS:{getByName(){return{fetch:async()=>new Response(null,{status:204})};}}};
const route=await import('../app/api/booths/[boothId]/reconciliation/route.ts');
function request(boothId){return route.POST(new Request(`https://app.test/api/booths/${boothId}/reconciliation`,{method:'POST',headers:{'content-type':'application/json',origin:'https://app.test'},body:JSON.stringify({cashTurnedIn:boothId===10?30:6,finalCounts:[{productId:100,quantity:0}],notes:''})}),{params:Promise.resolve({boothId:String(boothId)})});}

test('actual reconciliation handler blocks a sale without an eligible scout',async()=>{
 const response=await request(20); assert.equal(response.status,409); assert.match((await response.json()).error,/complete and balanced/);
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM reconciliations WHERE booth_id=20').get().count,0);
});

test('actual reconciliation handler atomically finalizes exact fractional credit once',async()=>{
 const response=await request(10); assert.equal(response.status,201);
 const credits=sqlite.prepare('SELECT scout_id,credit_numerator,credit_denominator FROM scout_sales_credits ORDER BY scout_id').all().map((row)=>({...row}));
 assert.deepEqual(credits,[{scout_id:50,credit_numerator:5,credit_denominator:2},{scout_id:51,credit_numerator:5,credit_denominator:2}]);
 assert.equal(sqlite.prepare('SELECT status FROM booths WHERE id=10').get().status,'closed');
 assert.equal((await request(10)).status,403);
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM scout_sales_credits').get().count,2);
});
