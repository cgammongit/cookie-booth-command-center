ALTER TABLE `booths` ADD `archived_at` text;
--> statement-breakpoint
ALTER TABLE `booths` ADD `archived_by_user_id` integer;
--> statement-breakpoint
ALTER TABLE `booths` ADD `archive_reason` text;
--> statement-breakpoint
ALTER TABLE `booths` ADD `archive_kind` text;
--> statement-breakpoint
CREATE INDEX `booth_organization_archived`
ON `booths` (`organization_id`, `archived_at`);
--> statement-breakpoint
CREATE TABLE `admin_alerts` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `organization_id` integer NOT NULL,
  `booth_id` integer NOT NULL,
  `type` text NOT NULL,
  `status` text DEFAULT 'open' NOT NULL,
  `muted` integer DEFAULT 0 NOT NULL,
  `acknowledged_by_user_id` integer,
  `acknowledged_at` text,
  `muted_by_user_id` integer,
  `muted_at` text,
  `resolution_note` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `admin_alert_org_status_created`
ON `admin_alerts` (`organization_id`, `status`, `created_at`);
--> statement-breakpoint
CREATE INDEX `admin_alert_booth`
ON `admin_alerts` (`booth_id`);
--> statement-breakpoint
CREATE TABLE `booth_lifecycle_audit` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `organization_id` integer NOT NULL,
  `booth_id` integer NOT NULL,
  `actor_user_id` integer NOT NULL,
  `action` text NOT NULL,
  `details_json` text NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `booth_lifecycle_audit_org_created`
ON `booth_lifecycle_audit` (`organization_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `booth_lifecycle_audit_booth`
ON `booth_lifecycle_audit` (`booth_id`);
