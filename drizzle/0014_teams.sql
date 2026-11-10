CREATE TABLE `teams` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT 'blue' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `team_members` (
	`team_id` integer NOT NULL,
	`member_id` integer NOT NULL,
	`is_lead` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`team_id`, `member_id`),
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `team_members_member_idx` ON `team_members` (`member_id`);
--> statement-breakpoint
ALTER TABLE `members` ADD `job_title` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `members` ADD `phone` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `tasks` ADD `team_id` integer REFERENCES teams(id) ON DELETE SET NULL;
--> statement-breakpoint
INSERT INTO `teams` (`name`, `color`, `description`) VALUES
	('Suporte', 'purple', 'Atendimento aos clientes e primeiro nível de chamados.'),
	('Desenvolvimento', 'blue', 'Construção e manutenção dos sistemas.'),
	('Liderança', 'orange', 'Coordenação dos times e decisões da empresa.');
