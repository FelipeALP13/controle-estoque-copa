ALTER TABLE `clients` ADD `contact_name` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `clients` ADD `contact_email` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `clients` ADD `contact_phone` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `clients` ADD `monthly_hours` real;
--> statement-breakpoint
ALTER TABLE `clients` ADD `notes` text DEFAULT '' NOT NULL;
--> statement-breakpoint
CREATE TABLE `sprints` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`team_id` integer,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`goal` text DEFAULT '' NOT NULL,
	`hours_per_day` real DEFAULT 6 NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`created_by_name` text DEFAULT 'Equipe' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`closed_at` text,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
ALTER TABLE `tasks` ADD `sprint_id` integer REFERENCES sprints(id) ON DELETE set null;
--> statement-breakpoint
CREATE TABLE `client_systems` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer NOT NULL,
	`team_id` integer,
	`name` text NOT NULL,
	`environment` text DEFAULT 'demo' NOT NULL,
	`url` text DEFAULT '' NOT NULL,
	`username` text DEFAULT '' NOT NULL,
	`password_enc` text,
	`notes` text DEFAULT '' NOT NULL,
	`monitor` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'unknown' NOT NULL,
	`last_checked_at` text,
	`last_change_at` text,
	`last_ms` integer,
	`last_error` text,
	`fail_count` integer DEFAULT 0 NOT NULL,
	`created_by_name` text DEFAULT 'Equipe' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `client_systems_client_idx` ON `client_systems` (`client_id`);
--> statement-breakpoint
CREATE INDEX `client_systems_monitor_idx` ON `client_systems` (`monitor`,`last_checked_at`);
--> statement-breakpoint
CREATE TABLE `system_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`system_id` integer NOT NULL,
	`kind` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`at` text NOT NULL,
	FOREIGN KEY (`system_id`) REFERENCES `client_systems`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `system_events_system_idx` ON `system_events` (`system_id`,`at`);
--> statement-breakpoint
CREATE TABLE `retros` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`team_id` integer,
	`sprint_id` integer,
	`anonymous` integer DEFAULT true NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_by_id` integer,
	`created_by_name` text DEFAULT 'Equipe' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`closed_at` text,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`sprint_id`) REFERENCES `sprints`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `retro_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`retro_id` integer NOT NULL,
	`kind` text NOT NULL,
	`text` text NOT NULL,
	`author_id` integer,
	`author_name` text DEFAULT '' NOT NULL,
	`task_id` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`retro_id`) REFERENCES `retros`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `retro_items_retro_idx` ON `retro_items` (`retro_id`);
--> statement-breakpoint
CREATE TABLE `retro_votes` (
	`item_id` integer NOT NULL,
	`member_id` integer NOT NULL,
	PRIMARY KEY(`item_id`, `member_id`),
	FOREIGN KEY (`item_id`) REFERENCES `retro_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `onboardings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`member_id` integer NOT NULL,
	`buddy_id` integer,
	`start_date` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by_name` text DEFAULT 'Equipe' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`buddy_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `onboarding_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`onboarding_id` integer NOT NULL,
	`text` text NOT NULL,
	`done` integer DEFAULT false NOT NULL,
	`done_by_name` text,
	`done_at` text,
	`sort_order` real DEFAULT 0 NOT NULL,
	FOREIGN KEY (`onboarding_id`) REFERENCES `onboardings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `onboarding_items_idx` ON `onboarding_items` (`onboarding_id`);
