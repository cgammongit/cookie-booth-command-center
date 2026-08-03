ALTER TABLE `booths` ADD `scout_assignment_revision` text NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE TABLE `scouts` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `organization_id` integer NOT NULL REFERENCES `organizations`(`id`) ON DELETE RESTRICT,
  `name` text NOT NULL,
  `age_level` text NOT NULL CHECK (`age_level` IN ('Daisy','Brownie','Junior','Cadette','Senior','Ambassador')),
  `archived_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scout_organization_name` ON `scouts` (`organization_id`, `name` COLLATE NOCASE);
--> statement-breakpoint
CREATE INDEX `scout_organization_archived_name` ON `scouts` (`organization_id`, `archived_at`, `name`);
--> statement-breakpoint
CREATE TABLE `booth_scout_assignments` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `organization_id` integer NOT NULL REFERENCES `organizations`(`id`) ON DELETE RESTRICT,
  `booth_id` integer NOT NULL REFERENCES `booths`(`id`) ON DELETE CASCADE,
  `scout_id` integer NOT NULL REFERENCES `scouts`(`id`) ON DELETE RESTRICT,
  `attendance_start` text NOT NULL,
  `attendance_end` text NOT NULL,
  `stayed_through_close` integer DEFAULT 0 NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CHECK (`attendance_start` < `attendance_end`),
  UNIQUE (`booth_id`, `scout_id`)
);
--> statement-breakpoint
CREATE INDEX `booth_scout_assignment_organization` ON `booth_scout_assignments` (`organization_id`);
--> statement-breakpoint
CREATE INDEX `booth_scout_assignment_scout` ON `booth_scout_assignments` (`scout_id`);
--> statement-breakpoint
CREATE TABLE `scout_sales_credits` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `organization_id` integer NOT NULL REFERENCES `organizations`(`id`) ON DELETE RESTRICT,
  `booth_id` integer NOT NULL REFERENCES `booths`(`id`) ON DELETE RESTRICT,
  `sale_id` text NOT NULL REFERENCES `sales`(`id`) ON DELETE RESTRICT,
  `transaction_id` text NOT NULL REFERENCES `transactions`(`id`) ON DELETE RESTRICT,
  `scout_id` integer NOT NULL REFERENCES `scouts`(`id`) ON DELETE RESTRICT,
  `reconciliation_id` integer NOT NULL REFERENCES `reconciliations`(`id`) ON DELETE RESTRICT,
  `credit_numerator` integer NOT NULL CHECK (`credit_numerator` > 0),
  `credit_denominator` integer NOT NULL CHECK (`credit_denominator` > 0),
  `finalized_at` text NOT NULL,
  UNIQUE (`transaction_id`, `scout_id`)
);
--> statement-breakpoint
CREATE INDEX `scout_credit_organization_scout` ON `scout_sales_credits` (`organization_id`, `scout_id`);
--> statement-breakpoint
CREATE INDEX `scout_credit_booth` ON `scout_sales_credits` (`booth_id`);
--> statement-breakpoint
CREATE INDEX `scout_credit_sale` ON `scout_sales_credits` (`sale_id`);
--> statement-breakpoint
CREATE INDEX `scout_credit_reconciliation` ON `scout_sales_credits` (`reconciliation_id`);
