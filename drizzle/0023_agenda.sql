CREATE TABLE `agenda_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` integer NOT NULL,
	`kind` text DEFAULT 'note' NOT NULL,
	`title` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text,
	`remind_before` integer,
	`teams_url` text DEFAULT '' NOT NULL,
	`done` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agenda_events_owner_idx` ON `agenda_events` (`owner_id`,`starts_at`);
--> statement-breakpoint
CREATE INDEX `agenda_events_starts_idx` ON `agenda_events` (`starts_at`);
--> statement-breakpoint
CREATE TABLE `agenda_attendees` (
	`event_id` integer NOT NULL,
	`member_id` integer NOT NULL,
	PRIMARY KEY(`event_id`, `member_id`),
	FOREIGN KEY (`event_id`) REFERENCES `agenda_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agenda_attendees_member_idx` ON `agenda_attendees` (`member_id`);
--> statement-breakpoint
CREATE TABLE `agenda_reminders` (
	`event_id` integer NOT NULL,
	`member_id` integer NOT NULL,
	`stage` text NOT NULL,
	`sent_at` text NOT NULL,
	PRIMARY KEY(`event_id`, `member_id`, `stage`),
	FOREIGN KEY (`event_id`) REFERENCES `agenda_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `notifications` ADD `event_id` integer REFERENCES agenda_events(id) ON DELETE cascade;
