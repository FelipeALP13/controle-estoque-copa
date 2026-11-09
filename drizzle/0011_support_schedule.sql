CREATE TABLE `support_teams` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT 'purple' NOT NULL,
	`members` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `support_weeks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`team_id` integer NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `support_teams`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `support_weeks_start_date_idx` ON `support_weeks` (`start_date`);
--> statement-breakpoint
INSERT INTO `support_teams` (`id`, `name`, `color`, `members`) VALUES
	(1, 'Equipe Roxa', 'purple', '["Lucas Pevarello","Lucas Boroto","Gabriel Moraes"]'),
	(2, 'Equipe Laranja', 'orange', '["Caio Viana","Angelo Salvatti","Luiz Miguel"]');
--> statement-breakpoint
INSERT INTO `support_weeks` (`start_date`, `end_date`, `team_id`) VALUES
	('2026-10-26', '2026-10-30', 1),
	('2026-11-03', '2026-11-06', 2),
	('2026-11-09', '2026-11-13', 1),
	('2026-11-16', '2026-11-19', 2),
	('2026-11-23', '2026-11-27', 1),
	('2026-11-30', '2026-12-04', 2),
	('2026-12-07', '2026-12-11', 1),
	('2026-12-14', '2026-12-18', 2);
