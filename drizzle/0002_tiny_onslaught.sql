CREATE TABLE `access_audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` integer NOT NULL,
	`actor_user_id` integer NOT NULL,
	`target_membership_id` integer NOT NULL,
	`action` text NOT NULL,
	`before_json` text NOT NULL,
	`after_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `access_audit_organization_created` ON `access_audit_log` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `access_audit_target_membership` ON `access_audit_log` (`target_membership_id`);--> statement-breakpoint
ALTER TABLE `memberships` ADD `status` text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `memberships` ADD `can_invite_users` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `memberships` ADD `created_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `memberships` ADD `updated_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `memberships`
SET
	`created_at` = CASE WHEN `created_at` = '' THEN datetime('now') ELSE `created_at` END,
	`updated_at` = CASE WHEN `updated_at` = '' THEN datetime('now') ELSE `updated_at` END;--> statement-breakpoint
CREATE UNIQUE INDEX `membership_organization_user` ON `memberships` (`organization_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `membership_organization_status` ON `memberships` (`organization_id`,`status`);
