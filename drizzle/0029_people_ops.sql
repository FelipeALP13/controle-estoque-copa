ALTER TABLE `announcements` ADD `team_id` integer REFERENCES teams(id);
--> statement-breakpoint
ALTER TABLE `announcements` ADD `reminded_at` text;
--> statement-breakpoint
CREATE TABLE `one_on_ones` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`leader_id` integer NOT NULL,
	`member_id` integer NOT NULL,
	`date` text NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`agenda` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`private_notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`leader_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `one_on_ones_member_idx` ON `one_on_ones` (`member_id`,`date`);
--> statement-breakpoint
CREATE INDEX `one_on_ones_leader_idx` ON `one_on_ones` (`leader_id`,`date`);
--> statement-breakpoint
CREATE TABLE `dev_actions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`member_id` integer NOT NULL,
	`title` text NOT NULL,
	`criterion` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`due_date` text,
	`status` text DEFAULT 'todo' NOT NULL,
	`created_by_name` text DEFAULT 'Equipe' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`done_at` text,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `dev_actions_member_idx` ON `dev_actions` (`member_id`);
--> statement-breakpoint
CREATE TABLE `pulse_surveys` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`month` text NOT NULL,
	`questions` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pulse_surveys_month_unique` ON `pulse_surveys` (`month`);
--> statement-breakpoint
CREATE TABLE `pulse_answers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`survey_id` integer NOT NULL,
	`scores` text NOT NULL,
	`comment` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`survey_id`) REFERENCES `pulse_surveys`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pulse_answers_survey_idx` ON `pulse_answers` (`survey_id`);
--> statement-breakpoint
CREATE TABLE `pulse_submissions` (
	`survey_id` integer NOT NULL,
	`member_id` integer NOT NULL,
	PRIMARY KEY(`survey_id`, `member_id`),
	FOREIGN KEY (`survey_id`) REFERENCES `pulse_surveys`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `assets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`category` text DEFAULT '' NOT NULL,
	`identifier` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'available' NOT NULL,
	`seats` integer DEFAULT 1 NOT NULL,
	`purchase_date` text,
	`expires_on` text,
	`cost` real,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `assets_kind_idx` ON `assets` (`kind`,`status`);
--> statement-breakpoint
CREATE TABLE `asset_assignments` (
	`asset_id` integer NOT NULL,
	`member_id` integer NOT NULL,
	`assigned_at` text NOT NULL,
	PRIMARY KEY(`asset_id`, `member_id`),
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `asset_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`asset_id` integer NOT NULL,
	`text` text NOT NULL,
	`by_name` text DEFAULT 'Equipe' NOT NULL,
	`at` text NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `asset_events_asset_idx` ON `asset_events` (`asset_id`);
--> statement-breakpoint
CREATE TABLE `incidents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer,
	`system_id` integer,
	`title` text NOT NULL,
	`severity` text DEFAULT 'medium' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`started_at` text NOT NULL,
	`resolved_at` text,
	`impact` text DEFAULT '' NOT NULL,
	`cause` text DEFAULT '' NOT NULL,
	`resolution` text DEFAULT '' NOT NULL,
	`prevention` text DEFAULT '' NOT NULL,
	`auto` integer DEFAULT false NOT NULL,
	`created_by_name` text DEFAULT 'Equipe' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`system_id`) REFERENCES `client_systems`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `incidents_status_idx` ON `incidents` (`status`,`started_at`);
--> statement-breakpoint
CREATE INDEX `incidents_system_idx` ON `incidents` (`system_id`);
--> statement-breakpoint
CREATE TABLE `incident_updates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`incident_id` integer NOT NULL,
	`body` text NOT NULL,
	`by_name` text DEFAULT 'Equipe' NOT NULL,
	`at` text NOT NULL,
	FOREIGN KEY (`incident_id`) REFERENCES `incidents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `incident_updates_incident_idx` ON `incident_updates` (`incident_id`);
