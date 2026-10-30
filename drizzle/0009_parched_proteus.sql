CREATE TABLE `inventory_locks` (
	`item_id` integer PRIMARY KEY NOT NULL,
	`owner_token` text NOT NULL,
	`acquired_at` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
