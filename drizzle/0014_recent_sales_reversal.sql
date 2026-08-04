ALTER TABLE `booths` ADD COLUMN `sales_revision` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `reconciliations` ADD COLUMN `sales_revision` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TRIGGER `reconciliation_sales_revision_guard`
BEFORE INSERT ON `reconciliations`
FOR EACH ROW
WHEN NEW.`sales_revision` <> COALESCE((SELECT `sales_revision` FROM `booths` WHERE `id` = NEW.`booth_id`), -1)
BEGIN
  SELECT RAISE(ABORT, 'booth sales changed during reconciliation');
END;
--> statement-breakpoint
CREATE TABLE `sale_reversals` (
  `id` text PRIMARY KEY NOT NULL,
  `sale_id` text NOT NULL,
  `organization_id` integer NOT NULL,
  `booth_id` integer NOT NULL,
  `reversed_by_user_id` integer NOT NULL,
  `reversed_by_clerk_user_id` text NOT NULL,
  `reason_code` text NOT NULL CHECK (`reason_code` IN (
    'wrong_cookies','wrong_quantity','wrong_payment_method','duplicate_sale','other'
  )),
  `reason_detail` text,
  `reversed_at` text NOT NULL,
  FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON DELETE RESTRICT,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT,
  FOREIGN KEY (`booth_id`) REFERENCES `booths`(`id`) ON DELETE RESTRICT,
  FOREIGN KEY (`reversed_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT,
  CHECK (
    (`reason_code` = 'other' AND length(trim(`reason_detail`)) BETWEEN 3 AND 200)
    OR (`reason_code` <> 'other' AND `reason_detail` IS NULL)
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sale_reversals_sale_unique` ON `sale_reversals` (`sale_id`);
--> statement-breakpoint
CREATE INDEX `sale_reversals_org_booth_time`
  ON `sale_reversals` (`organization_id`, `booth_id`, `reversed_at` DESC);
--> statement-breakpoint
CREATE INDEX `sales_booth_recent`
  ON `sales` (`booth_id`, `created_at` DESC, `id` DESC);
