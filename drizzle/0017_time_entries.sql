ALTER TABLE `tasks` ADD `base_hours` real;
--> statement-breakpoint
UPDATE `tasks` SET `base_hours` = `worked_hours`;
--> statement-breakpoint
CREATE TABLE `time_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_id` integer NOT NULL,
	`member_id` integer,
	`member_name` text DEFAULT 'Equipe' NOT NULL,
	`work_date` text NOT NULL,
	`hours` real NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_by_id` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `time_entries_task_idx` ON `time_entries` (`task_id`);
--> statement-breakpoint
CREATE INDEX `time_entries_date_idx` ON `time_entries` (`work_date`);
--> statement-breakpoint
CREATE INDEX `time_entries_member_idx` ON `time_entries` (`member_id`);
