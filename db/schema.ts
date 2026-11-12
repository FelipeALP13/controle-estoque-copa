import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const items = sqliteTable("items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  category: text("category").notNull().default("Outros"),
  unit: text("unit").notNull().default("un."),
  unopenedQty: real("unopened_qty").notNull().default(0),
  openedQty: real("opened_qty").notNull().default(0),
  minimumQty: real("minimum_qty").notNull().default(1),
  icon: text("icon").notNull().default("📦"),
  imageKey: text("image_key"),
  scanCode: text("scan_code").unique(),
  lastOpenedAt: text("last_opened_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const movements = sqliteTable("movements", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  itemId: integer("item_id")
    .notNull()
    .references(() => items.id, { onDelete: "cascade" }),
  type: text("type", { enum: ["purchase", "open", "consume", "adjust"] }).notNull(),
  quantity: real("quantity").notNull(),
  note: text("note").notNull().default(""),
  createdByUserId: text("created_by_user_id"),
  createdByName: text("created_by_name"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const openBatches = sqliteTable("open_batches", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  itemId: integer("item_id")
    .notNull()
    .references(() => items.id, { onDelete: "cascade" }),
  quantity: real("quantity").notNull(),
  remainingQty: real("remaining_qty").notNull(),
  openedAt: text("opened_at").notNull(),
  closedAt: text("closed_at"),
  closedReason: text("closed_reason", { enum: ["consumed", "adjusted"] }),
});

export const inventoryLocks = sqliteTable("inventory_locks", {
  itemId: integer("item_id")
    .primaryKey()
    .references(() => items.id, { onDelete: "cascade" }),
  ownerToken: text("owner_token").notNull(),
  acquiredAt: text("acquired_at").notNull(),
});

export const members = sqliteTable("members", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull().unique(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  role: text("role", { enum: ["admin", "member", "viewer"] }).notNull().default("member"),
  permissions: text("permissions").notNull().default("{}"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  avatarIcon: text("avatar_icon").notNull().default("👤"),
  avatarKey: text("avatar_key"),
  username: text("username").unique(),
  passwordHash: text("password_hash"),
  passwordSalt: text("password_salt"),
  jobTitle: text("job_title").notNull().default(""),
  phone: text("phone").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const teams = sqliteTable("teams", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  color: text("color").notNull().default("blue"),
  description: text("description").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const teamMembers = sqliteTable("team_members", {
  teamId: integer("team_id")
    .notNull()
    .references(() => teams.id, { onDelete: "cascade" }),
  memberId: integer("member_id")
    .notNull()
    .references(() => members.id, { onDelete: "cascade" }),
  isLead: integer("is_lead", { mode: "boolean" }).notNull().default(false),
}, (table) => [primaryKey({ columns: [table.teamId, table.memberId] })]);

export const sessions = sqliteTable("sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  memberId: integer("member_id")
    .notNull()
    .references(() => members.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const passwordResetTokens = sqliteTable("password_reset_tokens", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  memberId: integer("member_id")
    .notNull()
    .references(() => members.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: text("expires_at").notNull(),
  usedAt: text("used_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const authRateLimits = sqliteTable("auth_rate_limits", {
  key: text("key").primaryKey(),
  attempts: integer("attempts").notNull().default(0),
  windowStartedAt: text("window_started_at").notNull(),
  blockedUntil: text("blocked_until"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const supportTeams = sqliteTable("support_teams", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  color: text("color").notNull().default("purple"),
  // Lista de nomes em JSON, na ordem em que aparecem na tela.
  members: text("members").notNull().default("[]"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const supportWeeks = sqliteTable("support_weeks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  teamId: integer("team_id")
    .notNull()
    .references(() => supportTeams.id, { onDelete: "restrict" }),
  note: text("note").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const clients = sqliteTable("clients", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const projects = sqliteTable("projects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  clientId: integer("client_id").references(() => clients.id, { onDelete: "set null" }),
  status: text("status").notNull().default("todo"),
  farol: text("farol", { enum: ["red", "yellow", "blue", "green"] }).notNull().default("blue"),
  phase: text("phase", { enum: ["planning", "execution", "validation", "paused", "closing"] }).notNull().default("planning"),
  deadlineLabel: text("deadline_label").notNull().default(""),
  startDate: text("start_date"),
  endForecast: text("end_forecast").notNull().default(""),
  notes: text("notes").notNull().default(""),
  legacyKey: text("legacy_key").unique(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const projectPeople = sqliteTable("project_people", {
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  memberId: integer("member_id")
    .notNull()
    .references(() => members.id, { onDelete: "cascade" }),
}, (table) => [primaryKey({ columns: [table.projectId, table.memberId] })]);

export const tasks = sqliteTable("tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  status: text("status", { enum: ["backlog", "todo", "in_progress", "in_review", "waiting", "blocked", "paused", "done", "canceled"] }).notNull().default("todo"),
  // 0 sem prioridade, 1 crítica, 2 alta, 3 média, 4 baixa.
  priority: integer("priority").notNull().default(0),
  // Primeiro responsável; a lista completa fica em task_people.
  assigneeId: integer("assignee_id").references(() => members.id, { onDelete: "set null" }),
  teamId: integer("team_id").references(() => teams.id, { onDelete: "set null" }),
  clientId: integer("client_id").references(() => clients.id, { onDelete: "set null" }),
  projectId: integer("project_id").references(() => projects.id, { onDelete: "set null" }),
  category: text("category").notNull().default(""),
  openedOn: text("opened_on"),
  startDate: text("start_date"),
  dueDate: text("due_date"),
  completedOn: text("completed_on"),
  estimatedHours: real("estimated_hours"),
  // Total = horas anteriores (planilha ou digitadas antes do apontamento) + lançamentos de horas.
  workedHours: real("worked_hours"),
  baseHours: real("base_hours"),
  hoursFlag: integer("hours_flag", { mode: "boolean" }).notNull().default(false),
  origin: text("origin").notNull().default(""),
  notes: text("notes").notNull().default(""),
  sortOrder: real("sort_order").notNull().default(0),
  createdById: integer("created_by_id").references(() => members.id, { onDelete: "set null" }),
  createdByName: text("created_by_name").notNull().default("Equipe"),
  completedAt: text("completed_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

/** Responsáveis da demanda: "owner" (time que executa) e "support" (Resp. Suporte). */
export const taskPeople = sqliteTable("task_people", {
  taskId: integer("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  memberId: integer("member_id")
    .notNull()
    .references(() => members.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["owner", "support"] }).notNull().default("owner"),
}, (table) => [primaryKey({ columns: [table.taskId, table.memberId, table.role] })]);

/** Passos da demanda (checklist), marcados um a um. */
export const taskChecklistItems = sqliteTable("task_checklist_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  taskId: integer("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  done: integer("done", { mode: "boolean" }).notNull().default(false),
  doneByName: text("done_by_name"),
  doneAt: text("done_at"),
  sortOrder: real("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("task_checklist_task_idx").on(table.taskId)]);

/** Modelos de demanda: campos já preenchidos e os passos do checklist. */
export const taskTemplates = sqliteTable("task_templates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  title: text("title").notNull().default(""),
  description: text("description").notNull().default(""),
  category: text("category").notNull().default(""),
  teamId: integer("team_id").references(() => teams.id, { onDelete: "set null" }),
  priority: integer("priority").notNull().default(0),
  items: text("items").notNull().default("[]"),
  createdByName: text("created_by_name").notNull().default("Equipe"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

/** Códigos das planilhas antigas (AS-0019, JG-0001...), para busca e para não importar duas vezes. */
export const taskLegacyCodes = sqliteTable("task_legacy_codes", {
  code: text("code").primaryKey(),
  taskId: integer("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
});

/** Base de conhecimento: soluções que se repetem, com busca. Pode nascer de um chamado resolvido. */
export const kbArticles = sqliteTable("kb_articles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  clientId: integer("client_id").references(() => clients.id, { onDelete: "set null" }),
  teamId: integer("team_id").references(() => teams.id, { onDelete: "set null" }),
  tags: text("tags").notNull().default(""),
  ticketId: integer("ticket_id").references(() => tickets.id, { onDelete: "set null" }),
  createdById: integer("created_by_id").references(() => members.id, { onDelete: "set null" }),
  createdByName: text("created_by_name").notNull().default("Equipe"),
  updatedByName: text("updated_by_name").notNull().default("Equipe"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

/** Mural de avisos da Visão geral, com confirmação de leitura. */
export const announcements = sqliteTable("announcements", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  important: integer("important", { mode: "boolean" }).notNull().default(false),
  expiresOn: text("expires_on"),
  createdById: integer("created_by_id").references(() => members.id, { onDelete: "set null" }),
  createdByName: text("created_by_name").notNull().default("Equipe"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const announcementReads = sqliteTable("announcement_reads", {
  announcementId: integer("announcement_id")
    .notNull()
    .references(() => announcements.id, { onDelete: "cascade" }),
  memberId: integer("member_id")
    .notNull()
    .references(() => members.id, { onDelete: "cascade" }),
  readAt: text("read_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [primaryKey({ columns: [table.announcementId, table.memberId] })]);

/** Férias, folgas e outras ausências: aparecem na escala, no painel e ao escolher responsáveis. */
export const absences = sqliteTable("absences", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  memberId: integer("member_id")
    .notNull()
    .references(() => members.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["vacation", "day_off", "sick", "course", "other"] }).notNull().default("vacation"),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  note: text("note").notNull().default(""),
  createdById: integer("created_by_id").references(() => members.id, { onDelete: "set null" }),
  createdByName: text("created_by_name").notNull().default("Equipe"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("absences_member_idx").on(table.memberId), index("absences_end_idx").on(table.endDate)]);

/** Apontamento de horas: quem trabalhou, em que dia e quanto, em cada demanda. */
export const timeEntries = sqliteTable("time_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  taskId: integer("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  memberId: integer("member_id").references(() => members.id, { onDelete: "set null" }),
  memberName: text("member_name").notNull().default("Equipe"),
  workDate: text("work_date").notNull(),
  hours: real("hours").notNull(),
  note: text("note").notNull().default(""),
  createdById: integer("created_by_id").references(() => members.id, { onDelete: "set null" }),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("time_entries_task_idx").on(table.taskId), index("time_entries_date_idx").on(table.workDate), index("time_entries_member_idx").on(table.memberId)]);

export const taskEvents = sqliteTable("task_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  taskId: integer("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["comment", "created", "status", "priority", "assignee", "due_date", "title", "team", "people", "client", "category", "imported"] }).notNull(),
  body: text("body").notNull().default(""),
  actorId: integer("actor_id").references(() => members.id, { onDelete: "set null" }),
  actorName: text("actor_name").notNull().default("Equipe"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const tickets = sqliteTable("tickets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  type: text("type", { enum: ["bug", "question", "improvement", "access", "other"] }).notNull().default("question"),
  urgency: text("urgency", { enum: ["low", "normal", "high", "critical"] }).notNull().default("normal"),
  status: text("status", { enum: ["open", "in_progress", "waiting", "resolved", "canceled"] }).notNull().default("open"),
  client: text("client").notNull().default(""),
  teamId: integer("team_id").references(() => teams.id, { onDelete: "set null" }),
  requesterId: integer("requester_id").references(() => members.id, { onDelete: "set null" }),
  requesterName: text("requester_name").notNull().default("Equipe"),
  assigneeId: integer("assignee_id").references(() => members.id, { onDelete: "set null" }),
  taskId: integer("task_id").references(() => tasks.id, { onDelete: "set null" }),
  firstResponseAt: text("first_response_at"),
  resolvedAt: text("resolved_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  // Chamados que vieram do Jira: chave (ex.: DRH-123), link e status lá.
  source: text("source", { enum: ["portal", "jira"] }).notNull().default("portal"),
  jiraConnectionId: integer("jira_connection_id").references(() => jiraConnections.id, { onDelete: "set null" }),
  externalKey: text("external_key"),
  externalUrl: text("external_url"),
  externalStatus: text("external_status"),
  externalCategory: text("external_category"),
  externalUpdatedAt: text("external_updated_at"),
  // Quando o líder já foi avisado de que o chamado passou do prazo (para não avisar de novo).
  lateAlertedAt: text("late_alerted_at"),
}, (table) => [uniqueIndex("tickets_jira_key_unique").on(table.jiraConnectionId, table.externalKey)]);

/** Agenda pessoal: anotações com horário e reuniões (com convidados da equipe). */
export const agendaEvents = sqliteTable("agenda_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerId: integer("owner_id")
    .notNull()
    .references(() => members.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["note", "meeting"] }).notNull().default("note"),
  title: text("title").notNull(),
  notes: text("notes").notNull().default(""),
  // Início e fim em ISO (UTC). Fim é opcional (anotação pontual).
  startsAt: text("starts_at").notNull(),
  endsAt: text("ends_at"),
  // Minutos de antecedência do primeiro aviso (0 = só na hora; null = sem aviso).
  remindBefore: integer("remind_before"),
  teamsUrl: text("teams_url").notNull().default(""),
  done: integer("done", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("agenda_events_owner_idx").on(table.ownerId, table.startsAt), index("agenda_events_starts_idx").on(table.startsAt)]);

export const agendaAttendees = sqliteTable("agenda_attendees", {
  eventId: integer("event_id")
    .notNull()
    .references(() => agendaEvents.id, { onDelete: "cascade" }),
  memberId: integer("member_id")
    .notNull()
    .references(() => members.id, { onDelete: "cascade" }),
}, (table) => [primaryKey({ columns: [table.eventId, table.memberId] }), index("agenda_attendees_member_idx").on(table.memberId)]);

/** Lembretes já disparados (um por pessoa, compromisso e momento: "antes" ou "na hora"). */
export const agendaReminders = sqliteTable("agenda_reminders", {
  eventId: integer("event_id")
    .notNull()
    .references(() => agendaEvents.id, { onDelete: "cascade" }),
  memberId: integer("member_id")
    .notNull()
    .references(() => members.id, { onDelete: "cascade" }),
  stage: text("stage", { enum: ["before", "start"] }).notNull(),
  sentAt: text("sent_at").notNull(),
}, (table) => [primaryKey({ columns: [table.eventId, table.memberId, table.stage] })]);

/** Configurações do sistema (chave/valor). Sem uso no momento; mantida porque a tabela já existe no banco. */
export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull().default(""),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

/** Contas do Jira Cloud de onde os chamados são trazidos. A chave de API nunca volta para a tela. */
export const jiraConnections = sqliteTable("jira_connections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  baseUrl: text("base_url").notNull(),
  email: text("email").notNull(),
  apiToken: text("api_token").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  teamId: integer("team_id").references(() => teams.id, { onDelete: "set null" }),
  lastSyncAt: text("last_sync_at"),
  cursorAt: text("cursor_at"),
  lastError: text("last_error"),
  lockUntil: text("lock_until"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

/** Projetos de cada conta: quais trazer e de qual cliente são. */
export const jiraProjects = sqliteTable("jira_projects", {
  connectionId: integer("connection_id")
    .notNull()
    .references(() => jiraConnections.id, { onDelete: "cascade" }),
  projectKey: text("project_key").notNull(),
  projectName: text("project_name").notNull().default(""),
  clientId: integer("client_id").references(() => clients.id, { onDelete: "set null" }),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
}, (table) => [primaryKey({ columns: [table.connectionId, table.projectKey] })]);

export const ticketEvents = sqliteTable("ticket_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticketId: integer("ticket_id")
    .notNull()
    .references(() => tickets.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["comment", "created", "status", "assignee", "urgency", "team", "task"] }).notNull(),
  body: text("body").notNull().default(""),
  actorId: integer("actor_id").references(() => members.id, { onDelete: "set null" }),
  actorName: text("actor_name").notNull().default("Equipe"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  // Comentário trazido do Jira: id dele lá, para não trazer duas vezes.
  externalId: text("external_id"),
}, (table) => [uniqueIndex("ticket_events_external_unique").on(table.ticketId, table.externalId)]);

export const notifications = sqliteTable("notifications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  memberId: integer("member_id")
    .notNull()
    .references(() => members.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["task_assigned", "task_comment", "task_mention", "task_status", "ticket_new", "ticket_assigned", "ticket_comment", "ticket_mention", "ticket_status", "ticket_late", "agenda_reminder", "agenda_invite"] }).notNull(),
  taskId: integer("task_id").references(() => tasks.id, { onDelete: "cascade" }),
  ticketId: integer("ticket_id").references(() => tickets.id, { onDelete: "cascade" }),
  eventId: integer("event_id").references(() => agendaEvents.id, { onDelete: "cascade" }),
  actorName: text("actor_name").notNull().default("Equipe"),
  body: text("body").notNull().default(""),
  readAt: text("read_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const auditLogs = sqliteTable("audit_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  actorUserId: text("actor_user_id"),
  actorName: text("actor_name").notNull().default("Sistema"),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id"),
  details: text("details").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
