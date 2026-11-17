CREATE TABLE `integration_keys` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'atendechat' NOT NULL,
	`key_hash` text NOT NULL,
	`key_prefix` text NOT NULL,
	`team_id` integer,
	`kb_tag` text DEFAULT 'n1' NOT NULL,
	`created_by_name` text DEFAULT 'Equipe' NOT NULL,
	`created_at` text NOT NULL,
	`last_used_at` text,
	`revoked_at` text,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `integration_keys_hash_unique` ON `integration_keys` (`key_hash`);
