CREATE TABLE `product_catalog_audit` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `organization_id` integer NOT NULL,
  `product_id` integer NOT NULL,
  `actor_user_id` integer NOT NULL,
  `before_json` text NOT NULL,
  `after_json` text NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `product_catalog_audit_org_created`
ON `product_catalog_audit` (`organization_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `product_catalog_audit_product`
ON `product_catalog_audit` (`product_id`);
