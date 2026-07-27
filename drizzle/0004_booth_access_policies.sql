DELETE FROM `assignments`
WHERE `id` NOT IN (
  SELECT MIN(`id`)
  FROM `assignments`
  GROUP BY `booth_id`, `user_id`
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assignment_booth_user`
ON `assignments` (`booth_id`, `user_id`);
--> statement-breakpoint
CREATE INDEX `assignment_user`
ON `assignments` (`user_id`);
