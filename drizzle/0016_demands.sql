CREATE TABLE `clients` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clients_name_unique` ON `clients` (`name`);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`client_id` integer,
	`status` text DEFAULT 'todo' NOT NULL,
	`farol` text DEFAULT 'blue' NOT NULL,
	`phase` text DEFAULT 'planning' NOT NULL,
	`deadline_label` text DEFAULT '' NOT NULL,
	`start_date` text,
	`end_forecast` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`legacy_key` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_legacy_key_unique` ON `projects` (`legacy_key`);
--> statement-breakpoint
CREATE TABLE `project_people` (
	`project_id` integer NOT NULL,
	`member_id` integer NOT NULL,
	PRIMARY KEY(`project_id`, `member_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `tasks` ADD `client_id` integer REFERENCES clients(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `tasks` ADD `project_id` integer REFERENCES projects(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `tasks` ADD `category` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `tasks` ADD `opened_on` text;
--> statement-breakpoint
ALTER TABLE `tasks` ADD `start_date` text;
--> statement-breakpoint
ALTER TABLE `tasks` ADD `completed_on` text;
--> statement-breakpoint
ALTER TABLE `tasks` ADD `estimated_hours` real;
--> statement-breakpoint
ALTER TABLE `tasks` ADD `worked_hours` real;
--> statement-breakpoint
ALTER TABLE `tasks` ADD `hours_flag` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `tasks` ADD `origin` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `tasks` ADD `notes` text DEFAULT '' NOT NULL;
--> statement-breakpoint
CREATE TABLE `task_people` (
	`task_id` integer NOT NULL,
	`member_id` integer NOT NULL,
	`role` text DEFAULT 'owner' NOT NULL,
	PRIMARY KEY(`task_id`, `member_id`, `role`),
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `task_people_member_idx` ON `task_people` (`member_id`);
--> statement-breakpoint
CREATE TABLE `task_legacy_codes` (
	`code` text PRIMARY KEY NOT NULL,
	`task_id` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `task_legacy_codes_task_idx` ON `task_legacy_codes` (`task_id`);
--> statement-breakpoint
-- Quem já era responsável continua responsável na lista nova.
INSERT INTO `task_people` (`task_id`, `member_id`, `role`) SELECT `id`, `assignee_id`, 'owner' FROM `tasks` WHERE `assignee_id` IS NOT NULL;
--> statement-breakpoint
-- Data de conclusão das tarefas que já estavam concluídas.
UPDATE `tasks` SET `completed_on` = substr(`completed_at`, 1, 10) WHERE `completed_at` IS NOT NULL AND `completed_on` IS NULL;
--> statement-breakpoint
-- Clientes e projetos usados nas planilhas de Suporte e Desenvolvimento.
INSERT INTO `clients` (`name`) VALUES
	('SGE'), ('SGAD'), ('SGC'), ('SGC - Homologação'), ('Operadora'), ('Empresa'), ('SIGA'), ('IBBCA'),
	('ClubCard'), ('PlanoA'), ('MedCorp'), ('ADCPLASP'), ('Dr. Online'), ('Dr. Hoje'), ('Solutions'), ('Ativa'),
	('Allcare'), ('Plenus'), ('AiSales'), ('Associação'), ('ATOS'), ('Atendimento'), ('Todos os Projetos'),
	('Automação'), ('Projeto VOE'), ('Outros');
