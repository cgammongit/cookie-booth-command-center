import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const sqlite=new DatabaseSync(":memory:");
sqlite.exec(`PRAGMA foreign_keys=ON;
CREATE TABLE users(id INTEGER PRIMARY KEY,clerk_user_id TEXT,email TEXT,display_name TEXT,status TEXT,last_synced_at TEXT);
CREATE TABLE memberships(id INTEGER PRIMARY KEY,organization_id INTEGER,user_id INTEGER,role TEXT,status TEXT,can_invite_users INTEGER,created_at TEXT,updated_at TEXT);
CREATE TABLE booths(id INTEGER PRIMARY KEY,organization_id INTEGER,name TEXT,address TEXT,location_name TEXT,google_place_id TEXT,latitude REAL,longitude REAL,starts_at TEXT,ends_at TEXT,status TEXT,archived_at TEXT,archived_by_user_id INTEGER,archive_reason TEXT,archive_kind TEXT,scout_assignment_revision TEXT NOT NULL DEFAULT '');
CREATE TABLE scouts(id INTEGER PRIMARY KEY,organization_id INTEGER,name TEXT,age_level TEXT,archived_at TEXT,created_at TEXT,updated_at TEXT);
CREATE TABLE booth_scout_assignments(id INTEGER PRIMARY KEY AUTOINCREMENT,organization_id INTEGER,booth_id INTEGER,scout_id INTEGER,attendance_start TEXT,attendance_end TEXT,stayed_through_close INTEGER,created_at TEXT,updated_at TEXT,UNIQUE(booth_id,scout_id));
CREATE TABLE scout_sales_credits(id INTEGER PRIMARY KEY,organization_id INTEGER,booth_id INTEGER,sale_id TEXT,transaction_id TEXT,scout_id INTEGER,reconciliation_id INTEGER,credit_numerator INTEGER,credit_denominator INTEGER,finalized_at TEXT);
INSERT INTO users VALUES(1,'clerk-admin','a@test','Admin','active',''); INSERT INTO memberships VALUES(1,1,1,'admin','active',0,'','');
INSERT INTO booths VALUES(10,1,'Booth','Address',NULL,NULL,NULL,NULL,'2026-01-01T18:00:00.000Z','2026-01-01T20:00:00.000Z','live',NULL,NULL,NULL,NULL,'r1');
INSERT INTO scouts VALUES(50,1,'Active Scout','Junior',NULL,'',''),(51,1,'Archived Scout','Senior','2026-01-01','',''),(60,2,'Other Scout','Daisy',NULL,'','');`);
globalThis.__CLERK_TEST_AUTH__={userId:'clerk-admin'};
function norm(sql){return sql.replace(/\s+/g,' ').trim().toLowerCase();}
class Statement{constructor(sql){this.sql=sql;this.params=[];}bind(...p){this.params=p;return this;}async raw(){if(norm(this.sql).includes('from "users" inner join "memberships"'))return[[1,1,1,'admin','active',false]];return [];}async first(){return sqlite.prepare(this.sql).get(...this.params)??null;}async all(){return{results:sqlite.prepare(this.sql).all(...this.params),success:true,meta:{}};}async run(){const result=sqlite.prepare(this.sql).run(...this.params);return{success:true,meta:{changes:Number(result.changes),last_row_id:Number(result.lastInsertRowid)}};}}
class DB{prepare(sql){return new Statement(sql);}async batch(statements){sqlite.exec('BEGIN');try{const out=[];for(const statement of statements)out.push(await statement.run());sqlite.exec('COMMIT');return out;}catch(error){sqlite.exec('ROLLBACK');throw error;}}}
globalThis.__CLOUDFLARE_ENV__={DB:new DB()};
const route=await import('../app/api/admin/booth-scouts/route.ts');
const boothRoute=await import('../app/api/booths/route.ts');
function request(body){return new Request('https://app.test/api/admin/booth-scouts',{method:'PUT',headers:{'content-type':'application/json',origin:'https://app.test'},body:JSON.stringify(body)});}

test('actual attendance handler adds and updates valid attendance with durable close intent',async()=>{
 let response=await route.PUT(request({organizationId:1,boothId:10,revision:'r1',assignments:[{scoutId:50,attendanceStart:'2026-01-01T18:00:00.000Z',attendanceEnd:'2026-01-01T20:00:00.000Z'}]}));
 assert.equal(response.status,200); let payload=await response.json();
 let row=sqlite.prepare('SELECT * FROM booth_scout_assignments').get(); assert.equal(row.stayed_through_close,1);
 response=await route.PUT(request({organizationId:1,boothId:10,revision:payload.revision,assignments:[{scoutId:50,attendanceStart:'2026-01-01T18:30:00.000Z',attendanceEnd:'2026-01-01T19:00:00.000Z'}]}));
 assert.equal(response.status,200); row=sqlite.prepare('SELECT * FROM booth_scout_assignments').get(); assert.equal(row.stayed_through_close,0); assert.equal(row.attendance_end,'2026-01-01T19:00:00.000Z');
});

test('actual booth creation handler assigns selected active scouts with default attendance',async()=>{
 const response=await boothRoute.POST(new Request('https://app.test/api/booths',{method:'POST',headers:{'content-type':'application/json',origin:'https://app.test'},body:JSON.stringify({organizationId:1,name:'New Booth',address:'123 Test St',startsAt:'2026-02-01T18:00:00.000Z',endsAt:'2026-02-01T20:00:00.000Z',scoutIds:[50]})}));
 assert.equal(response.status,201); const {boothId}=await response.json();
 const assignment=sqlite.prepare('SELECT * FROM booth_scout_assignments WHERE booth_id=?').get(boothId);
 assert.equal(assignment.scout_id,50); assert.equal(assignment.attendance_start,'2026-02-01T18:00:00.000Z'); assert.equal(assignment.attendance_end,'2026-02-01T20:00:00.000Z'); assert.equal(assignment.stayed_through_close,1);
});

test('actual attendance handler rejects stale, invalid, archived-new, and cross-organization assignments',async()=>{
 const before=sqlite.prepare('SELECT * FROM booth_scout_assignments').all();
 assert.equal((await route.PUT(request({organizationId:1,boothId:10,revision:'stale',assignments:[]}))).status,409);
 const revision=sqlite.prepare('SELECT scout_assignment_revision AS revision FROM booths WHERE id=10').get().revision;
 assert.equal((await route.PUT(request({organizationId:1,boothId:10,revision,assignments:[{scoutId:50,attendanceStart:'2026-01-01T20:00:00.000Z',attendanceEnd:'2026-01-01T21:00:00.000Z'}]}))).status,400);
 assert.equal((await route.PUT(request({organizationId:1,boothId:10,revision,assignments:[{scoutId:51,attendanceStart:'2026-01-01T18:00:00.000Z',attendanceEnd:'2026-01-01T20:00:00.000Z'}]}))).status,403);
 assert.equal((await route.PUT(request({organizationId:1,boothId:10,revision,assignments:[{scoutId:60,attendanceStart:'2026-01-01T18:00:00.000Z',attendanceEnd:'2026-01-01T20:00:00.000Z'}]}))).status,403);
 assert.deepEqual(sqlite.prepare('SELECT * FROM booth_scout_assignments').all(),before);
});

test('finalized credit prevents removing attendance and closed booths lock changes',async()=>{
 const assignment=sqlite.prepare('SELECT * FROM booth_scout_assignments').get();
 sqlite.prepare("INSERT INTO scout_sales_credits VALUES(1,1,10,'s','t',50,1,1,1,'2026-01-01')").run();
 let revision=sqlite.prepare('SELECT scout_assignment_revision AS revision FROM booths WHERE id=10').get().revision;
 assert.equal((await route.PUT(request({organizationId:1,boothId:10,revision,assignments:[]}))).status,409);
 sqlite.prepare("UPDATE booths SET status='closed' WHERE id=10").run(); revision=sqlite.prepare('SELECT scout_assignment_revision AS revision FROM booths WHERE id=10').get().revision;
 assert.equal((await route.PUT(request({organizationId:1,boothId:10,revision,assignments:[{scoutId:assignment.scout_id,attendanceStart:assignment.attendance_start,attendanceEnd:assignment.attendance_end}]}))).status,409);
});
