ALTER TABLE `chat_messages` ADD `pinned_at` text;
--> statement-breakpoint
ALTER TABLE `chat_messages` ADD `pinned_by_name` text;
--> statement-breakpoint
ALTER TABLE `goal_items` ADD `task_id` integer REFERENCES tasks(id) ON DELETE set null;
--> statement-breakpoint
CREATE INDEX `goal_items_task_idx` ON `goal_items` (`task_id`);
