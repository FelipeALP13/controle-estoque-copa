ALTER TABLE `chat_messages` ADD `task_id` integer REFERENCES tasks(id) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `chat_presence` ADD `status_kind` text;
--> statement-breakpoint
ALTER TABLE `chat_presence` ADD `status_until` text;
--> statement-breakpoint
CREATE TABLE `chat_reminders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`member_id` integer NOT NULL,
	`message_id` integer NOT NULL,
	`remind_at` text NOT NULL,
	`fired_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `chat_messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chat_reminders_due_idx` ON `chat_reminders` (`member_id`,`fired_at`,`remind_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_reminders_message_idx` ON `chat_reminders` (`member_id`,`message_id`);
