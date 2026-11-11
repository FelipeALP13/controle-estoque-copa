CREATE TABLE `jira_connections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`base_url` text NOT NULL,
	`email` text NOT NULL,
	`api_token` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`team_id` integer,
	`last_sync_at` text,
	`cursor_at` text,
	`last_error` text,
	`lock_until` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `jira_projects` (
	`connection_id` integer NOT NULL,
	`project_key` text NOT NULL,
	`project_name` text DEFAULT '' NOT NULL,
	`client_id` integer,
	`enabled` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`connection_id`, `project_key`),
	FOREIGN KEY (`connection_id`) REFERENCES `jira_connections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
ALTER TABLE `tickets` ADD `source` text DEFAULT 'portal' NOT NULL;
--> statement-breakpoint
ALTER TABLE `tickets` ADD `jira_connection_id` integer REFERENCES jira_connections(id) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `tickets` ADD `external_key` text;
--> statement-breakpoint
ALTER TABLE `tickets` ADD `external_url` text;
--> statement-breakpoint
ALTER TABLE `tickets` ADD `external_status` text;
--> statement-breakpoint
ALTER TABLE `tickets` ADD `external_category` text;
--> statement-breakpoint
ALTER TABLE `tickets` ADD `external_updated_at` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `tickets_jira_key_unique` ON `tickets` (`jira_connection_id`,`external_key`);
--> statement-breakpoint
ALTER TABLE `ticket_events` ADD `external_id` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `ticket_events_external_unique` ON `ticket_events` (`ticket_id`,`external_id`);
