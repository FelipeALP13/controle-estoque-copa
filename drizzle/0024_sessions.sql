ALTER TABLE `sessions` ADD `last_seen_at` text;
--> statement-breakpoint
ALTER TABLE `sessions` ADD `device` text DEFAULT '' NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `sessions_member_idx` ON `sessions` (`member_id`);
--> statement-breakpoint
UPDATE `sessions` SET `last_seen_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `last_seen_at` IS NULL;
