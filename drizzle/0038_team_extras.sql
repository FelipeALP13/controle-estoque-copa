ALTER TABLE `tickets` ADD `rated_by` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `tickets` ADD `survey_token` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `tickets_survey_token_unique` ON `tickets` (`survey_token`);
--> statement-breakpoint
ALTER TABLE `members` ADD `totp_secret` text;
--> statement-breakpoint
ALTER TABLE `members` ADD `totp_enabled_at` text;
--> statement-breakpoint
ALTER TABLE `members` ADD `totp_recovery` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `notifications` ADD `pushed_at` text;
--> statement-breakpoint
ALTER TABLE `chat_messages` ADD `poll_id` integer;
--> statement-breakpoint
CREATE TABLE `project_milestones` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`title` text NOT NULL,
	`date` text NOT NULL,
	`done` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_milestones_project_idx` ON `project_milestones` (`project_id`,`date`);
--> statement-breakpoint
CREATE TABLE `project_dependencies` (
	`project_id` integer NOT NULL,
	`depends_on_id` integer NOT NULL,
	PRIMARY KEY(`project_id`, `depends_on_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`depends_on_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `polls` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`question` text NOT NULL,
	`options` text DEFAULT '[]' NOT NULL,
	`multiple` integer DEFAULT false NOT NULL,
	`anonymous` integer DEFAULT false NOT NULL,
	`channel_id` integer,
	`created_by_id` integer,
	`created_by_name` text DEFAULT 'Equipe' NOT NULL,
	`closes_at` text,
	`closed_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `chat_channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `polls_channel_idx` ON `polls` (`channel_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `poll_votes` (
	`poll_id` integer NOT NULL,
	`member_id` integer NOT NULL,
	`option` integer NOT NULL,
	PRIMARY KEY(`poll_id`, `member_id`, `option`),
	FOREIGN KEY (`poll_id`) REFERENCES `polls`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `kudos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`from_id` integer,
	`from_name` text DEFAULT 'Equipe' NOT NULL,
	`to_id` integer NOT NULL,
	`value` text DEFAULT '' NOT NULL,
	`message` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`from_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`to_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `kudos_to_idx` ON `kudos` (`to_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `kudos_created_idx` ON `kudos` (`created_at`);
--> statement-breakpoint
CREATE TABLE `chat_scheduled` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`member_id` integer NOT NULL,
	`channel_id` integer NOT NULL,
	`topic_id` integer,
	`body` text NOT NULL,
	`send_at` text NOT NULL,
	`sent_at` text,
	`message_id` integer,
	`error` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`channel_id`) REFERENCES `chat_channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`topic_id`) REFERENCES `chat_topics`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chat_scheduled_due_idx` ON `chat_scheduled` (`sent_at`,`send_at`);
--> statement-breakpoint
CREATE INDEX `chat_scheduled_member_idx` ON `chat_scheduled` (`member_id`);
--> statement-breakpoint
CREATE TABLE `maintenance_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`category` text DEFAULT 'other' NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_by_id` integer,
	`created_by_name` text DEFAULT 'Equipe' NOT NULL,
	`assignee_id` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`resolved_at` text,
	FOREIGN KEY (`created_by_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`assignee_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `maintenance_status_idx` ON `maintenance_requests` (`status`,`created_at`);
--> statement-breakpoint
CREATE TABLE `maintenance_updates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`request_id` integer NOT NULL,
	`body` text NOT NULL,
	`by_name` text DEFAULT 'Equipe' NOT NULL,
	`at` text NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `maintenance_requests`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `maintenance_updates_request_idx` ON `maintenance_updates` (`request_id`);
--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`member_id` integer NOT NULL,
	`endpoint` text NOT NULL,
	`device` text DEFAULT '' NOT NULL,
	`fail_count` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`last_ok_at` text,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_endpoint_unique` ON `push_subscriptions` (`endpoint`);
--> statement-breakpoint
CREATE INDEX `push_subscriptions_member_idx` ON `push_subscriptions` (`member_id`);
--> statement-breakpoint
CREATE TABLE `login_challenges` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`member_id` integer NOT NULL,
	`token_hash` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `login_challenges_token_unique` ON `login_challenges` (`token_hash`);
--> statement-breakpoint
CREATE TABLE `login_places` (
	`member_id` integer NOT NULL,
	`place` text NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	PRIMARY KEY(`member_id`, `place`),
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `ticket_summaries` (
	`ticket_id` integer PRIMARY KEY NOT NULL,
	`summary` text NOT NULL,
	`based_on` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON UPDATE no action ON DELETE cascade
);
