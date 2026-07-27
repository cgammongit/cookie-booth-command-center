ALTER TABLE `booths` ADD `location_name` text;
--> statement-breakpoint
ALTER TABLE `booths` ADD `google_place_id` text;
--> statement-breakpoint
ALTER TABLE `booths` ADD `latitude` real;
--> statement-breakpoint
ALTER TABLE `booths` ADD `longitude` real;
--> statement-breakpoint
CREATE INDEX `booth_organization_status_start`
ON `booths` (`organization_id`, `status`, `starts_at`);
--> statement-breakpoint
CREATE INDEX `booth_google_place`
ON `booths` (`google_place_id`);
