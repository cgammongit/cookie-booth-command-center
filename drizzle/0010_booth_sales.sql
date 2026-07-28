CREATE TABLE `sales` (
  `id` text PRIMARY KEY NOT NULL,
  `booth_id` integer NOT NULL,
  `operator_id` integer NOT NULL,
  `payment_method` text NOT NULL CHECK (`payment_method` IN ('cash','credit_card','venmo_paypal')),
  `box_count` integer NOT NULL CHECK (`box_count` > 0),
  `total_amount` real NOT NULL CHECK (`total_amount` >= 0),
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sales_booth_created` ON `sales` (`booth_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `sales_booth_payment` ON `sales` (`booth_id`, `payment_method`);
--> statement-breakpoint
ALTER TABLE `transactions` ADD COLUMN `sale_id` text;
--> statement-breakpoint
CREATE INDEX `transactions_sale` ON `transactions` (`sale_id`);
--> statement-breakpoint
CREATE TRIGGER `inventory_prevent_oversell`
BEFORE UPDATE OF `sold` ON `inventory`
WHEN NEW.sold < 0 OR NEW.sold > NEW.opening + NEW.adjusted
BEGIN
  SELECT RAISE(ABORT, 'Booth inventory is insufficient for this sale');
END;
--> statement-breakpoint
ALTER TABLE `inventory_ledger` RENAME TO `inventory_ledger_legacy`;
--> statement-breakpoint
CREATE TABLE `inventory_ledger` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `organization_id` integer NOT NULL,
  `product_id` integer NOT NULL,
  `booth_id` integer,
  `actor_user_id` integer,
  `movement_type` text NOT NULL CHECK (`movement_type` IN (
    'initial_order','replenishment','booth_allocation','booth_return','booth_sale',
    'trade_in','trade_out','council_return','damage','loss',
    'correction_in','correction_out','legacy_migration'
  )),
  `total_delta` integer NOT NULL DEFAULT 0,
  `available_delta` integer NOT NULL DEFAULT 0,
  `booth_delta` integer NOT NULL DEFAULT 0,
  `reason` text,
  `reference` text,
  `created_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `inventory_ledger`
SELECT * FROM `inventory_ledger_legacy`;
--> statement-breakpoint
DROP TABLE `inventory_ledger_legacy`;
--> statement-breakpoint
CREATE INDEX `inventory_ledger_org_created` ON `inventory_ledger` (`organization_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `inventory_ledger_product_created` ON `inventory_ledger` (`product_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `inventory_ledger_booth` ON `inventory_ledger` (`booth_id`);
