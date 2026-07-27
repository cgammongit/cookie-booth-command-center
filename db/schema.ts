import {index,integer,real,sqliteTable,text,uniqueIndex} from "drizzle-orm/sqlite-core";
export const organizations=sqliteTable("organizations",{id:integer("id").primaryKey({autoIncrement:true}),name:text("name").notNull()});
export const users=sqliteTable("users",{
 id:integer("id").primaryKey({autoIncrement:true}),
 clerkUserId:text("clerk_user_id").unique(),
 email:text("email").notNull().unique(),
 displayName:text("display_name").notNull(),
 status:text("status",{enum:["active","disabled"]}).notNull().default("active"),
 lastSyncedAt:text("last_synced_at").notNull().default(""),
});
export const memberships=sqliteTable("memberships",{
 id:integer("id").primaryKey({autoIncrement:true}),
 organizationId:integer("organization_id").notNull(),
 userId:integer("user_id").notNull(),
 role:text("role",{enum:["admin","lead","volunteer","auditor"]}).notNull(),
 status:text("status",{enum:["pending","active","suspended"]}).notNull().default("active"),
 canInviteUsers:integer("can_invite_users",{mode:"boolean"}).notNull().default(false),
 createdAt:text("created_at").notNull().default(""),
 updatedAt:text("updated_at").notNull().default(""),
},t=>[
 uniqueIndex("membership_organization_user").on(t.organizationId,t.userId),
 index("membership_organization_status").on(t.organizationId,t.status),
]);
export const accessAuditLog=sqliteTable("access_audit_log",{
 id:integer("id").primaryKey({autoIncrement:true}),
 organizationId:integer("organization_id").notNull(),
 actorUserId:integer("actor_user_id").notNull(),
 targetMembershipId:integer("target_membership_id").notNull(),
 action:text("action",{enum:["role_changed","status_changed","invitation_rights_changed","invitation_created","invitation_resent","invitation_cancelled","invitation_accepted","booth_assigned","booth_unassigned"]}).notNull(),
 beforeJson:text("before_json").notNull(),
 afterJson:text("after_json").notNull(),
 createdAt:text("created_at").notNull(),
},t=>[
 index("access_audit_organization_created").on(t.organizationId,t.createdAt),
 index("access_audit_target_membership").on(t.targetMembershipId),
]);
export const organizationInvitations=sqliteTable("organization_invitations",{
 id:integer("id").primaryKey({autoIncrement:true}),
 organizationId:integer("organization_id").notNull(),
 membershipId:integer("membership_id").notNull(),
 email:text("email").notNull(),
 role:text("role",{enum:["admin","lead","volunteer","auditor"]}).notNull(),
 canInviteUsers:integer("can_invite_users",{mode:"boolean"}).notNull().default(false),
 status:text("status",{enum:["pending","accepted","cancelled","expired"]}).notNull().default("pending"),
 clerkInvitationId:text("clerk_invitation_id").notNull().unique(),
 invitedByUserId:integer("invited_by_user_id").notNull(),
 createdAt:text("created_at").notNull(),
 updatedAt:text("updated_at").notNull(),
 acceptedAt:text("accepted_at"),
 cancelledAt:text("cancelled_at"),
},t=>[
 index("organization_invitation_org_status").on(t.organizationId,t.status),
 index("organization_invitation_email_status").on(t.email,t.status),
 index("organization_invitation_membership").on(t.membershipId),
]);
export const booths=sqliteTable("booths",{
 id:integer("id").primaryKey({autoIncrement:true}),
 organizationId:integer("organization_id").notNull(),
 name:text("name").notNull(),
 address:text("address").notNull(),
 locationName:text("location_name"),
 googlePlaceId:text("google_place_id"),
 latitude:real("latitude"),
 longitude:real("longitude"),
 startsAt:text("starts_at").notNull(),
 endsAt:text("ends_at").notNull(),
 status:text("status",{enum:["draft","scheduled","live","closed"]}).notNull().default("draft"),
},t=>[
 index("booth_organization_status_start").on(t.organizationId,t.status,t.startsAt),
 index("booth_google_place").on(t.googlePlaceId),
]);
export const assignments=sqliteTable("assignments",{
 id:integer("id").primaryKey({autoIncrement:true}),
 boothId:integer("booth_id").notNull(),
 userId:integer("user_id").notNull(),
 role:text("role",{enum:["lead","volunteer","auditor"]}).notNull(),
},t=>[
 uniqueIndex("assignment_booth_user").on(t.boothId,t.userId),
 index("assignment_user").on(t.userId),
]);
export const products=sqliteTable("products",{id:integer("id").primaryKey({autoIncrement:true}),organizationId:integer("organization_id").notNull(),name:text("name").notNull(),barcode:text("barcode").notNull(),price:real("price").notNull().default(6)},t=>[uniqueIndex("product_barcode_org").on(t.organizationId,t.barcode)]);
export const inventory=sqliteTable("inventory",{id:integer("id").primaryKey({autoIncrement:true}),boothId:integer("booth_id").notNull(),productId:integer("product_id").notNull(),opening:integer("opening").notNull(),sold:integer("sold").notNull().default(0),adjusted:integer("adjusted").notNull().default(0)},t=>[uniqueIndex("inventory_booth_product").on(t.boothId,t.productId)]);
export const transactions=sqliteTable("transactions",{id:text("id").primaryKey(),boothId:integer("booth_id").notNull(),productId:integer("product_id").notNull(),operatorId:integer("operator_id").notNull(),type:text("type",{enum:["sale","correction","adjustment"]}).notNull(),quantity:integer("quantity").notNull(),amount:real("amount").notNull(),reason:text("reason"),createdAt:text("created_at").notNull()});
export const reconciliations=sqliteTable("reconciliations",{id:integer("id").primaryKey({autoIncrement:true}),boothId:integer("booth_id").notNull().unique(),closedBy:integer("closed_by").notNull(),cashTotal:real("cash_total").notNull(),digitalTotal:real("digital_total").notNull(),notes:text("notes"),closedAt:text("closed_at").notNull()});
