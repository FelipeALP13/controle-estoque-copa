CREATE TABLE `purchase_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` integer NOT NULL,
	`quantity` real NOT NULL,
	`status` text DEFAULT 'needed' NOT NULL,
	`supplier` text DEFAULT '' NOT NULL,
	`assigned_to` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_by_name` text DEFAULT 'Equipe' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `stock_counts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` integer NOT NULL,
	`expected_qty` real NOT NULL,
	`actual_qty` real NOT NULL,
	`difference` real NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_by_name` text DEFAULT 'Equipe' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `stock_lots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` integer NOT NULL,
	`quantity` real NOT NULL,
	`expires_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `items` ADD `supplier` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `items` ADD `lead_time_days` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `items` ADD `safety_stock` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `items` ADD `scan_code` text;--> statement-breakpoint
CREATE UNIQUE INDEX `items_scan_code_unique` ON `items` (`scan_code`);