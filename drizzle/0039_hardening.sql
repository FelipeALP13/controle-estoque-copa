ALTER TABLE `members` ADD `totp_last_step` integer;
--> statement-breakpoint
CREATE INDEX `notifications_push_idx` ON `notifications` (`pushed_at`,`created_at`);
