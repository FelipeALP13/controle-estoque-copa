ALTER TABLE `chat_messages` ADD `attachments` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
CREATE TABLE `chat_presence` (
	`member_id` integer PRIMARY KEY NOT NULL,
	`last_seen_at` text NOT NULL,
	`typing_channel_id` integer,
	`typing_at` text,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
