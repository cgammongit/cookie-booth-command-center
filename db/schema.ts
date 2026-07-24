import {integer,real,sqliteTable,text,uniqueIndex} from "drizzle-orm/sqlite-core";
export const organizations=sqliteTable("organizations",{id:integer("id").primaryKey({autoIncrement:true}),name:text("name").notNull()});
export const users=sqliteTable("users",{
 id:integer("id").primaryKey({autoIncrement:true}),
 clerkUserId:text("clerk_user_id").unique(),
 email:text("email").notNull().unique(),
 displayName:text("display_name").notNull(),
 status:text("status",{enum:["active","disabled"]}).notNull().default("active"),
 lastSyncedAt:text("last_synced_at").notNull().default(""),
});
export const memberships=sqliteTable("memberships",{id:integer("id").primaryKey({autoIncrement:true}),organizationId:integer("organization_id").notNull(),userId:integer("user_id").notNull(),role:text("role",{enum:["admin","lead","volunteer","auditor"]}).notNull()});
export const booths=sqliteTable("booths",{id:integer("id").primaryKey({autoIncrement:true}),organizationId:integer("organization_id").notNull(),name:text("name").notNull(),address:text("address").notNull(),startsAt:text("starts_at").notNull(),endsAt:text("ends_at").notNull(),status:text("status",{enum:["draft","scheduled","live","closed"]}).notNull().default("draft")});
export const assignments=sqliteTable("assignments",{id:integer("id").primaryKey({autoIncrement:true}),boothId:integer("booth_id").notNull(),userId:integer("user_id").notNull(),role:text("role",{enum:["lead","volunteer","auditor"]}).notNull()});
export const products=sqliteTable("products",{id:integer("id").primaryKey({autoIncrement:true}),organizationId:integer("organization_id").notNull(),name:text("name").notNull(),barcode:text("barcode").notNull(),price:real("price").notNull().default(6)},t=>[uniqueIndex("product_barcode_org").on(t.organizationId,t.barcode)]);
export const inventory=sqliteTable("inventory",{id:integer("id").primaryKey({autoIncrement:true}),boothId:integer("booth_id").notNull(),productId:integer("product_id").notNull(),opening:integer("opening").notNull(),sold:integer("sold").notNull().default(0),adjusted:integer("adjusted").notNull().default(0)},t=>[uniqueIndex("inventory_booth_product").on(t.boothId,t.productId)]);
export const transactions=sqliteTable("transactions",{id:text("id").primaryKey(),boothId:integer("booth_id").notNull(),productId:integer("product_id").notNull(),operatorId:integer("operator_id").notNull(),type:text("type",{enum:["sale","correction","adjustment"]}).notNull(),quantity:integer("quantity").notNull(),amount:real("amount").notNull(),reason:text("reason"),createdAt:text("created_at").notNull()});
export const reconciliations=sqliteTable("reconciliations",{id:integer("id").primaryKey({autoIncrement:true}),boothId:integer("booth_id").notNull().unique(),closedBy:integer("closed_by").notNull(),cashTotal:real("cash_total").notNull(),digitalTotal:real("digital_total").notNull(),notes:text("notes"),closedAt:text("closed_at").notNull()});
