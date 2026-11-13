ALTER TABLE `members` ADD `birthday` text;
--> statement-breakpoint
ALTER TABLE `members` ADD `started_on` text;
--> statement-breakpoint
CREATE TABLE `ticket_replies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`team_id` integer,
	`created_by_id` integer,
	`created_by_name` text DEFAULT 'Equipe' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `task_timers` (
	`member_id` integer PRIMARY KEY NOT NULL,
	`task_id` integer NOT NULL,
	`started_at` text NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `task_dependencies` (
	`task_id` integer NOT NULL,
	`blocked_by_id` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`task_id`, `blocked_by_id`),
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`blocked_by_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `task_dependencies_blocker_idx` ON `task_dependencies` (`blocked_by_id`);
--> statement-breakpoint
CREATE TABLE `handoffs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`week_id` integer,
	`team_name` text DEFAULT '' NOT NULL,
	`body` text NOT NULL,
	`created_by_id` integer,
	`created_by_name` text DEFAULT 'Equipe' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`week_id`) REFERENCES `support_weeks`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `handoff_reads` (
	`handoff_id` integer NOT NULL,
	`member_id` integer NOT NULL,
	`read_at` text NOT NULL,
	PRIMARY KEY(`handoff_id`, `member_id`),
	FOREIGN KEY (`handoff_id`) REFERENCES `handoffs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `celebration_alerts` (
	`key` text PRIMARY KEY NOT NULL,
	`sent_at` text NOT NULL
);
