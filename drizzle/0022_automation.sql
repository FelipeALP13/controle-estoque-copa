CREATE TABLE IF NOT EXISTS `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text DEFAULT '' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE `tickets` ADD `late_alerted_at` text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `movements_item_created_idx` ON `movements` (`item_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `movements_created_idx` ON `movements` (`created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `open_batches_item_idx` ON `open_batches` (`item_id`,`opened_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `tasks_due_idx` ON `tasks` (`due_date`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `tasks_team_idx` ON `tasks` (`team_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `tasks_client_idx` ON `tasks` (`client_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `tasks_project_idx` ON `tasks` (`project_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `tickets_created_idx` ON `tickets` (`created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `tickets_assignee_idx` ON `tickets` (`assignee_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `notifications_unread_idx` ON `notifications` (`member_id`,`read_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `audit_logs_created_idx` ON `audit_logs` (`created_at`);
