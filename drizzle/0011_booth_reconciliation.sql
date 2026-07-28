ALTER TABLE `reconciliations` ADD COLUMN `expected_cash_total` real NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `reconciliations` ADD COLUMN `cash_discrepancy` real NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `reconciliations` ADD COLUMN `credit_card_total` real NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `reconciliations` ADD COLUMN `venmo_paypal_total` real NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `reconciliations` ADD COLUMN `gross_total` real NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `reconciliations` ADD COLUMN `expected_box_count` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `reconciliations` ADD COLUMN `actual_box_count` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `reconciliations` ADD COLUMN `inventory_discrepancy_count` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TABLE `reconciliation_items` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `reconciliation_id` integer NOT NULL,
  `product_id` integer NOT NULL,
  `expected_remaining` integer NOT NULL CHECK (`expected_remaining` >= 0),
  `actual_remaining` integer NOT NULL CHECK (`actual_remaining` >= 0),
  `discrepancy` integer NOT NULL,
  `returned_to_troop` integer NOT NULL CHECK (`returned_to_troop` >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reconciliation_item_reconciliation_product`
  ON `reconciliation_items` (`reconciliation_id`, `product_id`);
--> statement-breakpoint
CREATE INDEX `reconciliation_item_product` ON `reconciliation_items` (`product_id`);
