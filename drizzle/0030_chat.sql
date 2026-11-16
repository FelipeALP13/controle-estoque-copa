CREATE TABLE `chat_channels` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text DEFAULT 'channel' NOT NULL,
	`name` text NOT NULL,
	`topic` text DEFAULT '' NOT NULL,
	`team_id` integer,
	`dm_key` text,
	`created_by_id` integer,
	`created_by_name` text DEFAULT 'Equipe' NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`last_message_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_channels_dm_unique` ON `chat_channels` (`dm_key`);
--> statement-breakpoint
INSERT INTO `chat_channels` (`kind`, `name`, `topic`) VALUES ('channel', 'geral', 'Conversa de toda a equipe'), ('channel', 'off-topic', 'Assuntos fora do trabalho: memes, futebol, almoço…');
--> statement-breakpoint
INSERT INTO `chat_channels` (`kind`, `name`, `topic`, `team_id`) SELECT 'channel', lower(replace(trim(`name`), ' ', '-')), 'Conversa do time ' || `name`, `id` FROM `teams`;
--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`channel_id` integer NOT NULL,
	`member_id` integer,
	`author_name` text DEFAULT 'Equipe' NOT NULL,
	`body` text NOT NULL,
	`reply_to_id` integer,
	`edited_at` text,
	`deleted` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `chat_channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `chat_messages_channel_idx` ON `chat_messages` (`channel_id`,`id`);
--> statement-breakpoint
CREATE TABLE `chat_reactions` (
	`message_id` integer NOT NULL,
	`member_id` integer NOT NULL,
	`emoji` text NOT NULL,
	PRIMARY KEY(`message_id`, `member_id`, `emoji`),
	FOREIGN KEY (`message_id`) REFERENCES `chat_messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `chat_reads` (
	`channel_id` integer NOT NULL,
	`member_id` integer NOT NULL,
	`last_read_id` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`channel_id`, `member_id`),
	FOREIGN KEY (`channel_id`) REFERENCES `chat_channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
