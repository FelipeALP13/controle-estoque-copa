CREATE TABLE `attachments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_type` text NOT NULL,
	`owner_id` integer NOT NULL,
	`storage_key` text NOT NULL,
	`file_name` text NOT NULL,
	`content_type` text DEFAULT 'application/octet-stream' NOT NULL,
	`size` integer DEFAULT 0 NOT NULL,
	`uploaded_by_id` integer,
	`uploaded_by_name` text DEFAULT 'Equipe' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`uploaded_by_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attachments_key_unique` ON `attachments` (`storage_key`);
--> statement-breakpoint
CREATE INDEX `attachments_owner_idx` ON `attachments` (`owner_type`,`owner_id`);
--> statement-breakpoint
ALTER TABLE `agenda_events` ADD `repeat` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `agenda_events` ADD `repeat_until` text;
--> statement-breakpoint
CREATE TABLE `task_recurrences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_task_id` integer NOT NULL,
	`frequency` text NOT NULL,
	`day` integer NOT NULL,
	`due_days` integer,
	`next_on` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`last_task_id` integer,
	`created_by_id` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`source_task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`last_task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_recurrences_source_unique` ON `task_recurrences` (`source_task_id`);
--> statement-breakpoint
CREATE INDEX `task_recurrences_next_idx` ON `task_recurrences` (`active`,`next_on`);
--> statement-breakpoint
ALTER TABLE `tickets` ADD `rating` integer;
--> statement-breakpoint
ALTER TABLE `tickets` ADD `rating_comment` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `tickets` ADD `rated_at` text;
--> statement-breakpoint
ALTER TABLE `members` ADD `calendar_token_hash` text;
