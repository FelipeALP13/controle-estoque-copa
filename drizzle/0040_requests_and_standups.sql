ALTER TABLE `absences` ADD `status` text DEFAULT 'approved' NOT NULL;
--> statement-breakpoint
ALTER TABLE `absences` ADD `decided_by_name` text;
--> statement-breakpoint
ALTER TABLE `absences` ADD `decided_at` text;
--> statement-breakpoint
ALTER TABLE `absences` ADD `decision_note` text DEFAULT '' NOT NULL;
--> statement-breakpoint
CREATE INDEX `absences_status_idx` ON `absences` (`status`);
--> statement-breakpoint
CREATE TABLE `shift_swaps` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`from_week_id` integer NOT NULL,
	`to_week_id` integer NOT NULL,
	`requester_id` integer,
	`requester_name` text DEFAULT 'Equipe' NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`decided_by_name` text,
	`decided_at` text,
	`decision_note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`from_week_id`) REFERENCES `support_weeks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_week_id`) REFERENCES `support_weeks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requester_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `shift_swaps_status_idx` ON `shift_swaps` (`status`);
--> statement-breakpoint
CREATE TABLE `standups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`member_id` integer NOT NULL,
	`day` text NOT NULL,
	`yesterday` text DEFAULT '' NOT NULL,
	`today` text DEFAULT '' NOT NULL,
	`blockers` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `standups_member_day_idx` ON `standups` (`member_id`,`day`);
--> statement-breakpoint
CREATE INDEX `standups_day_idx` ON `standups` (`day`);
