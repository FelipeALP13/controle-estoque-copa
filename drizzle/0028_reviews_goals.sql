CREATE TABLE `review_cycles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`peer_criteria` text DEFAULT '[]' NOT NULL,
	`company_criteria` text DEFAULT '[]' NOT NULL,
	`manager_criteria` text DEFAULT '[]' NOT NULL,
	`created_by_name` text DEFAULT 'Equipe' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`closed_at` text
);
--> statement-breakpoint
CREATE TABLE `review_managers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
INSERT INTO `review_managers` (`name`, `title`) VALUES ('Michel Sobral', 'Gerente'), ('Vitor Sobral', 'CEO');
--> statement-breakpoint
CREATE TABLE `review_answers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cycle_id` integer NOT NULL,
	`target` text NOT NULL,
	`scores` text NOT NULL,
	`comment` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`cycle_id`) REFERENCES `review_cycles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `review_answers_cycle_idx` ON `review_answers` (`cycle_id`,`target`);
--> statement-breakpoint
CREATE TABLE `review_submissions` (
	`cycle_id` integer NOT NULL,
	`reviewer_id` integer NOT NULL,
	`target` text NOT NULL,
	PRIMARY KEY(`cycle_id`, `reviewer_id`, `target`),
	FOREIGN KEY (`cycle_id`) REFERENCES `review_cycles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reviewer_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `goals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`year` integer NOT NULL,
	`scope` text NOT NULL,
	`team_id` integer,
	`member_id` integer,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`unit` text DEFAULT '' NOT NULL,
	`direction` text DEFAULT 'up' NOT NULL,
	`start_value` real DEFAULT 0 NOT NULL,
	`target` real NOT NULL,
	`current` real DEFAULT 0 NOT NULL,
	`created_by_name` text DEFAULT 'Equipe' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `goals_year_idx` ON `goals` (`year`,`scope`);
--> statement-breakpoint
CREATE TABLE `goal_updates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`goal_id` integer NOT NULL,
	`value` real NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`by_name` text DEFAULT 'Equipe' NOT NULL,
	`at` text NOT NULL,
	FOREIGN KEY (`goal_id`) REFERENCES `goals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `goal_updates_goal_idx` ON `goal_updates` (`goal_id`);
