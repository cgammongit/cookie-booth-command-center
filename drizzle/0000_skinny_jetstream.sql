CREATE TABLE `assignments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`booth_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`role` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `booths` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` integer NOT NULL,
	`name` text NOT NULL,
	`address` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `inventory` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`booth_id` integer NOT NULL,
	`product_id` integer NOT NULL,
	`opening` integer NOT NULL,
	`sold` integer DEFAULT 0 NOT NULL,
	`adjusted` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_booth_product` ON `inventory` (`booth_id`,`product_id`);--> statement-breakpoint
CREATE TABLE `memberships` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`role` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` integer NOT NULL,
	`name` text NOT NULL,
	`barcode` text NOT NULL,
	`price` real DEFAULT 6 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_barcode_org` ON `products` (`organization_id`,`barcode`);--> statement-breakpoint
CREATE TABLE `reconciliations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`booth_id` integer NOT NULL,
	`closed_by` integer NOT NULL,
	`cash_total` real NOT NULL,
	`digital_total` real NOT NULL,
	`notes` text,
	`closed_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reconciliations_booth_id_unique` ON `reconciliations` (`booth_id`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`booth_id` integer NOT NULL,
	`product_id` integer NOT NULL,
	`operator_id` integer NOT NULL,
	`type` text NOT NULL,
	`quantity` integer NOT NULL,
	`amount` real NOT NULL,
	`reason` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);