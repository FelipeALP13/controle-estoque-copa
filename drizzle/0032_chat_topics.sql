CREATE TABLE `chat_topics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`channel_id` integer NOT NULL,
	`title` text NOT NULL,
	`resolved` integer DEFAULT false NOT NULL,
	`created_by_id` integer,
	`created_by_name` text DEFAULT 'Equipe' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_message_at` text,
	FOREIGN KEY (`channel_id`) REFERENCES `chat_channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `chat_topics_channel_idx` ON `chat_topics` (`channel_id`,`last_message_at`);
--> statement-breakpoint
CREATE TABLE `chat_topic_reads` (
	`topic_id` integer NOT NULL,
	`member_id` integer NOT NULL,
	`last_read_id` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`topic_id`, `member_id`),
	FOREIGN KEY (`topic_id`) REFERENCES `chat_topics`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `chat_messages` ADD `topic_id` integer REFERENCES chat_topics(id) ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX `chat_messages_topic_idx` ON `chat_messages` (`topic_id`,`id`);
--> statement-breakpoint
ALTER TABLE `chat_presence` ADD `typing_topic_id` integer;
--> statement-breakpoint
INSERT INTO `chat_topics` (`channel_id`, `title`, `created_by_name`, `created_at`, `last_message_at`) SELECT c.`id`, CASE c.`kind` WHEN 'dm' THEN 'Conversa' ELSE 'Conversa geral' END, 'Portal', c.`created_at`, c.`last_message_at` FROM `chat_channels` c WHERE c.`kind` = 'dm' OR EXISTS (SELECT 1 FROM `chat_messages` m WHERE m.`channel_id` = c.`id`);
--> statement-breakpoint
UPDATE `chat_messages` SET `topic_id` = (SELECT t.`id` FROM `chat_topics` t WHERE t.`channel_id` = `chat_messages`.`channel_id` ORDER BY t.`id` LIMIT 1);
--> statement-breakpoint
INSERT OR IGNORE INTO `chat_topic_reads` (`topic_id`, `member_id`, `last_read_id`) SELECT t.`id`, r.`member_id`, r.`last_read_id` FROM `chat_reads` r JOIN `chat_topics` t ON t.`channel_id` = r.`channel_id`;
