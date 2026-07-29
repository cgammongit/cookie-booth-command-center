CREATE TABLE `super_admin_audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor_clerk_user_id` text NOT NULL,
	`actor_user_id` integer,
	`actor_display_name` text NOT NULL,
	`action` text NOT NULL,
	`target_organization_id` integer NOT NULL,
	`target_organization_name` text NOT NULL,
	`reason` text,
	`deleted_counts_json` text NOT NULL,
	`outcome` text NOT NULL,
	`request_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `super_admin_audit_created` ON `super_admin_audit_log` (`created_at`);
--> statement-breakpoint
CREATE INDEX `super_admin_audit_target_created` ON `super_admin_audit_log` (`target_organization_id`,`created_at`);
