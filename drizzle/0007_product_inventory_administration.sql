ALTER TABLE `products` ADD `active` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `products` ADD `updated_at` text DEFAULT '' NOT NULL;
--> statement-breakpoint
CREATE INDEX `product_organization_active_name`
ON `products` (`organization_id`, `active`, `name`);
--> statement-breakpoint
CREATE TABLE `inventory_configuration_audit` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `organization_id` integer NOT NULL,
  `booth_id` integer NOT NULL,
  `actor_user_id` integer NOT NULL,
  `before_json` text NOT NULL,
  `after_json` text NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `inventory_configuration_audit_org_created`
ON `inventory_configuration_audit` (`organization_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `inventory_configuration_audit_booth`
ON `inventory_configuration_audit` (`booth_id`);
