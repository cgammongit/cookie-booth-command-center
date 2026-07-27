CREATE TABLE `troop_inventory_balances` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `organization_id` integer NOT NULL,
  `product_id` integer NOT NULL,
  `total_remaining` integer NOT NULL DEFAULT 0 CHECK (`total_remaining` >= 0),
  `available` integer NOT NULL DEFAULT 0 CHECK (`available` >= 0 AND `available` <= `total_remaining`),
  `updated_at` text NOT NULL,
  CONSTRAINT `troop_inventory_balance_org_product` UNIQUE (`organization_id`, `product_id`)
);
--> statement-breakpoint
CREATE INDEX `troop_inventory_balance_org` ON `troop_inventory_balances` (`organization_id`);
--> statement-breakpoint
CREATE TABLE `inventory_ledger` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `organization_id` integer NOT NULL,
  `product_id` integer NOT NULL,
  `booth_id` integer,
  `actor_user_id` integer,
  `movement_type` text NOT NULL CHECK (`movement_type` IN (
    'initial_order','replenishment','booth_allocation','booth_return',
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
CREATE INDEX `inventory_ledger_org_created` ON `inventory_ledger` (`organization_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `inventory_ledger_product_created` ON `inventory_ledger` (`product_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `inventory_ledger_booth` ON `inventory_ledger` (`booth_id`);
--> statement-breakpoint
INSERT INTO `troop_inventory_balances` (
  `organization_id`, `product_id`, `total_remaining`, `available`, `updated_at`
)
SELECT
  p.organization_id,
  p.id,
  COALESCE(SUM(MAX(i.opening - i.sold + i.adjusted, 0)), 0),
  0,
  datetime('now')
FROM products p
LEFT JOIN inventory i ON i.product_id = p.id
GROUP BY p.organization_id, p.id;
--> statement-breakpoint
INSERT INTO `inventory_ledger` (
  `organization_id`, `product_id`, `booth_id`, `actor_user_id`,
  `movement_type`, `total_delta`, `available_delta`, `booth_delta`,
  `reason`, `reference`, `created_at`
)
SELECT
  p.organization_id,
  i.product_id,
  i.booth_id,
  NULL,
  'legacy_migration',
  MAX(i.opening - i.sold + i.adjusted, 0),
  0,
  MAX(i.opening - i.sold + i.adjusted, 0),
  'Opening booth inventory migrated into the troop ledger',
  'migration-0009',
  datetime('now')
FROM inventory i
JOIN products p ON p.id = i.product_id
WHERE MAX(i.opening - i.sold + i.adjusted, 0) > 0;
