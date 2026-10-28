CREATE TABLE `open_batches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` integer NOT NULL,
	`quantity` real NOT NULL,
	`remaining_qty` real NOT NULL,
	`opened_at` text NOT NULL,
	`closed_at` text,
	`closed_reason` text,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
