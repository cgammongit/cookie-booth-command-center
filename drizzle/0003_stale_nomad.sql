CREATE TABLE `organization_invitations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` integer NOT NULL,
	`membership_id` integer NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`can_invite_users` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`clerk_invitation_id` text NOT NULL,
	`invited_by_user_id` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`accepted_at` text,
	`cancelled_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_invitations_clerk_invitation_id_unique` ON `organization_invitations` (`clerk_invitation_id`);--> statement-breakpoint
CREATE INDEX `organization_invitation_org_status` ON `organization_invitations` (`organization_id`,`status`);--> statement-breakpoint
CREATE INDEX `organization_invitation_email_status` ON `organization_invitations` (`email`,`status`);--> statement-breakpoint
CREATE INDEX `organization_invitation_membership` ON `organization_invitations` (`membership_id`);