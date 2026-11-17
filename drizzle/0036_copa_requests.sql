CREATE TABLE `copa_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`item_id` integer,
	`created_by_id` integer,
	`created_by_name` text DEFAULT 'Equipe' NOT NULL,
	`decided_by_name` text,
	`decision_note` text DEFAULT '' NOT NULL,
	`decided_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `copa_requests_status_idx` ON `copa_requests` (`status`,`created_at`);
--> statement-breakpoint
CREATE TABLE `copa_request_votes` (
	`request_id` integer NOT NULL,
	`member_id` integer NOT NULL,
	PRIMARY KEY(`request_id`, `member_id`),
	FOREIGN KEY (`request_id`) REFERENCES `copa_requests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
