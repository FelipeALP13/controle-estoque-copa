ALTER TABLE `goals` ADD `mode` text DEFAULT 'number' NOT NULL;
--> statement-breakpoint
CREATE TABLE `goal_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`goal_id` integer NOT NULL,
	`text` text NOT NULL,
	`done` integer DEFAULT false NOT NULL,
	`done_by_name` text,
	`done_at` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`goal_id`) REFERENCES `goals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `goal_items_goal_idx` ON `goal_items` (`goal_id`,`sort_order`);
