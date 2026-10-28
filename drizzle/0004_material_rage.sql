ALTER TABLE `items` ADD `icon` text DEFAULT '📦' NOT NULL;--> statement-breakpoint
ALTER TABLE `items` ADD `image_key` text;--> statement-breakpoint
ALTER TABLE `members` ADD `avatar_icon` text DEFAULT '👤' NOT NULL;--> statement-breakpoint
ALTER TABLE `members` ADD `avatar_key` text;