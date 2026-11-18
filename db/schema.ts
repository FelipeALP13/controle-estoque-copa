import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";

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
  /** Resumo (hash) do link secreto da agenda para o Outlook; o link em si não fica guardado. */
  calendarTokenHash: text("calendar_token_hash"),
  /** Aniversário sem o ano ("MM-DD"), opcional. */
  birthday: text("birthday"),
  /** Data de entrada na empresa (AAAA-MM-DD), para o tempo de casa. */
  startedOn: text("started_on"),
  // Verificação em duas etapas: segredo do aplicativo autenticador (criptografado) e quando foi ligada.
  totpSecret: text("totp_secret"),
  totpEnabledAt: text("totp_enabled_at"),
  // Códigos de recuperação (JSON com os resumos SHA-256; cada um vale uma vez).
  totpRecovery: text("totp_recovery").notNull().default("[]"),
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
  /** Último uso (renovado no máximo a cada 15 min). Sem uso por 7 dias, a sessão cai. */
  lastSeenAt: text("last_seen_at"),
  /** Nome curto do aparelho ("Chrome no Windows"), para a lista de sessões. */
  device: text("device").notNull().default(""),
}, (table) => [index("sessions_member_idx").on(table.memberId)]);

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
  // Ficha do cliente: contato principal, pacote de horas por mês e observações.
  contactName: text("contact_name").notNull().default(""),
  contactEmail: text("contact_email").notNull().default(""),
  contactPhone: text("contact_phone").notNull().default(""),
  monthlyHours: real("monthly_hours"),
  notes: text("notes").notNull().default(""),
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
  sprintId: integer("sprint_id").references(() => sprints.id, { onDelete: "set null" }),
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
  // Público: um time (só quem está nele vê) ou todos (null).
  teamId: integer("team_id").references(() => teams.id, { onDelete: "set null" }),
  remindedAt: text("reminded_at"),
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
  source: text("source", { enum: ["portal", "jira", "atendechat"] }).notNull().default("portal"),
  jiraConnectionId: integer("jira_connection_id").references(() => jiraConnections.id, { onDelete: "set null" }),
  externalKey: text("external_key"),
  externalUrl: text("external_url"),
  externalStatus: text("external_status"),
  externalCategory: text("external_category"),
  externalUpdatedAt: text("external_updated_at"),
  // Quando o líder já foi avisado de que o chamado passou do prazo (para não avisar de novo).
  lateAlertedAt: text("late_alerted_at"),
  // Avaliação de quem abriu (1 a 5), feita depois de resolvido.
  rating: integer("rating"),
  ratingComment: text("rating_comment").notNull().default(""),
  ratedAt: text("rated_at"),
  // Quem deu a nota: "client" (cliente, pelo link de avaliação) ou "" (quem abriu, na equipe).
  ratedBy: text("rated_by").notNull().default(""),
  // Código do link de avaliação enviado ao cliente (criado quando alguém pede o link).
  surveyToken: text("survey_token"),
}, (table) => [uniqueIndex("tickets_jira_key_unique").on(table.jiraConnectionId, table.externalKey), uniqueIndex("tickets_survey_token_unique").on(table.surveyToken)]);

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
  // Repetição: "" (não repete), "daily", "weekdays", "weekly" ou "monthly"; até (AAAA-MM-DD) opcional.
  repeat: text("repeat").notNull().default(""),
  repeatUntil: text("repeat_until"),
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
  // "before"/"start" ou, em compromissos que se repetem, "before@<início da ocorrência>".
  stage: text("stage").notNull(),
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
  kind: text("kind", { enum: ["task_assigned", "task_comment", "task_mention", "task_status", "ticket_new", "ticket_assigned", "ticket_comment", "ticket_mention", "ticket_status", "ticket_late", "agenda_reminder", "agenda_invite", "ticket_rate", "task_unblocked", "handoff", "celebration", "system_down", "system_up", "onboarding", "review_open", "review_reminder", "goal_update", "one_on_one", "dev_action", "pulse_open", "announcement", "incident", "asset_expiring", "chat_mention", "chat_reminder", "stock_low", "copa_request", "kudos", "poll", "maintenance", "security_alert"] }).notNull(),
  taskId: integer("task_id").references(() => tasks.id, { onDelete: "cascade" }),
  ticketId: integer("ticket_id").references(() => tickets.id, { onDelete: "cascade" }),
  eventId: integer("event_id").references(() => agendaEvents.id, { onDelete: "cascade" }),
  actorName: text("actor_name").notNull().default("Equipe"),
  body: text("body").notNull().default(""),
  readAt: text("read_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  // Quando o aviso foi mandado para o celular (null = ainda não).
  pushedAt: text("pushed_at"),
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

/** Arquivos anexados a demandas e chamados (o arquivo fica no R2; aqui só os dados). */
export const attachments = sqliteTable("attachments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerType: text("owner_type", { enum: ["task", "ticket"] }).notNull(),
  ownerId: integer("owner_id").notNull(),
  storageKey: text("storage_key").notNull(),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull().default("application/octet-stream"),
  size: integer("size").notNull().default(0),
  uploadedById: integer("uploaded_by_id").references(() => members.id, { onDelete: "set null" }),
  uploadedByName: text("uploaded_by_name").notNull().default("Equipe"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("attachments_key_unique").on(table.storageKey), index("attachments_owner_idx").on(table.ownerType, table.ownerId)]);

/** Demanda que se repete: copia a demanda de origem na data marcada (semanal ou mensal). */
export const taskRecurrences = sqliteTable("task_recurrences", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sourceTaskId: integer("source_task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  frequency: text("frequency", { enum: ["weekly", "monthly"] }).notNull(),
  // Semanal: dia da semana (1 = segunda ... 7 = domingo). Mensal: dia do mês (1 a 28).
  day: integer("day").notNull(),
  // Prazo da cópia: dias depois de criada (null = sem prazo).
  dueDays: integer("due_days"),
  nextOn: text("next_on").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  lastTaskId: integer("last_task_id").references(() => tasks.id, { onDelete: "set null" }),
  createdById: integer("created_by_id").references(() => members.id, { onDelete: "set null" }),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("task_recurrences_source_unique").on(table.sourceTaskId), index("task_recurrences_next_idx").on(table.active, table.nextOn)]);

/** Respostas prontas dos chamados (do time ou de todos), inseridas no comentário com um clique. */
export const ticketReplies = sqliteTable("ticket_replies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  body: text("body").notNull(),
  teamId: integer("team_id").references(() => teams.id, { onDelete: "set null" }),
  createdById: integer("created_by_id").references(() => members.id, { onDelete: "set null" }),
  createdByName: text("created_by_name").notNull().default("Equipe"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

/** Cronômetro de horas: no máximo um rodando por pessoa. Ao parar, vira um lançamento de horas. */
export const taskTimers = sqliteTable("task_timers", {
  memberId: integer("member_id").primaryKey().references(() => members.id, { onDelete: "cascade" }),
  taskId: integer("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  startedAt: text("started_at").notNull(),
});

/** Dependências: a demanda (taskId) só começa quando a outra (blockedById) terminar. */
export const taskDependencies = sqliteTable("task_dependencies", {
  taskId: integer("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  blockedById: integer("blocked_by_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [primaryKey({ columns: [table.taskId, table.blockedById] }), index("task_dependencies_blocker_idx").on(table.blockedById)]);

/** Passagem de plantão: o que a equipe que sai deixa para a que entra. */
export const handoffs = sqliteTable("handoffs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  weekId: integer("week_id").references(() => supportWeeks.id, { onDelete: "set null" }),
  teamName: text("team_name").notNull().default(""),
  body: text("body").notNull(),
  createdById: integer("created_by_id").references(() => members.id, { onDelete: "set null" }),
  createdByName: text("created_by_name").notNull().default("Equipe"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const handoffReads = sqliteTable("handoff_reads", {
  handoffId: integer("handoff_id").notNull().references(() => handoffs.id, { onDelete: "cascade" }),
  memberId: integer("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  readAt: text("read_at").notNull(),
}, (table) => [primaryKey({ columns: [table.handoffId, table.memberId] })]);

/** Avisos de aniversário e tempo de casa já enviados (um por pessoa e ano). */
export const celebrationAlerts = sqliteTable("celebration_alerts", {
  key: text("key").primaryKey(),
  sentAt: text("sent_at").notNull(),
});

/** Sistemas dos clientes: endereço, login de acesso (senha criptografada) e monitor de "no ar". */
export const clientSystems = sqliteTable("client_systems", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  // Time dono do acesso: só ele (e administradores) vê usuário e senha.
  teamId: integer("team_id").references(() => teams.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  environment: text("environment").notNull().default("demo"),
  url: text("url").notNull().default(""),
  username: text("username").notNull().default(""),
  passwordEnc: text("password_enc"),
  notes: text("notes").notNull().default(""),
  monitor: integer("monitor", { mode: "boolean" }).notNull().default(false),
  status: text("status").notNull().default("unknown"),
  lastCheckedAt: text("last_checked_at"),
  lastChangeAt: text("last_change_at"),
  lastMs: integer("last_ms"),
  lastError: text("last_error"),
  failCount: integer("fail_count").notNull().default(0),
  createdByName: text("created_by_name").notNull().default("Equipe"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("client_systems_client_idx").on(table.clientId), index("client_systems_monitor_idx").on(table.monitor, table.lastCheckedAt)]);

/** Quedas e voltas de cada sistema monitorado. */
export const systemEvents = sqliteTable("system_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  systemId: integer("system_id").notNull().references(() => clientSystems.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["down", "up"] }).notNull(),
  detail: text("detail").notNull().default(""),
  at: text("at").notNull(),
}, (table) => [index("system_events_system_idx").on(table.systemId, table.at)]);

/** Sprints: período de trabalho de um time, com as demandas planejadas. */
export const sprints = sqliteTable("sprints", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  teamId: integer("team_id").references(() => teams.id, { onDelete: "set null" }),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  goal: text("goal").notNull().default(""),
  hoursPerDay: real("hours_per_day").notNull().default(6),
  status: text("status", { enum: ["planned", "active", "closed"] }).notNull().default("planned"),
  createdByName: text("created_by_name").notNull().default("Equipe"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  closedAt: text("closed_at"),
});

/** Retrospectivas: o que foi bem, o que melhorar e as ações, com votos. */
export const retros = sqliteTable("retros", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  teamId: integer("team_id").references(() => teams.id, { onDelete: "set null" }),
  sprintId: integer("sprint_id").references(() => sprints.id, { onDelete: "set null" }),
  anonymous: integer("anonymous", { mode: "boolean" }).notNull().default(true),
  status: text("status", { enum: ["open", "closed"] }).notNull().default("open"),
  createdById: integer("created_by_id").references(() => members.id, { onDelete: "set null" }),
  createdByName: text("created_by_name").notNull().default("Equipe"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  closedAt: text("closed_at"),
});

export const retroItems = sqliteTable("retro_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  retroId: integer("retro_id").notNull().references(() => retros.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["good", "improve", "action"] }).notNull(),
  text: text("text").notNull(),
  // Guardado só para a pessoa poder apagar o que escreveu; em retrospectiva anônima nunca vai para a tela.
  authorId: integer("author_id").references(() => members.id, { onDelete: "set null" }),
  authorName: text("author_name").notNull().default(""),
  taskId: integer("task_id").references(() => tasks.id, { onDelete: "set null" }),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("retro_items_retro_idx").on(table.retroId)]);

export const retroVotes = sqliteTable("retro_votes", {
  itemId: integer("item_id").notNull().references(() => retroItems.id, { onDelete: "cascade" }),
  memberId: integer("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
}, (table) => [primaryKey({ columns: [table.itemId, table.memberId] })]);

/** Integração de quem chega: checklist dos primeiros dias, com um padrinho. */
export const onboardings = sqliteTable("onboardings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  memberId: integer("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  buddyId: integer("buddy_id").references(() => members.id, { onDelete: "set null" }),
  startDate: text("start_date").notNull(),
  status: text("status", { enum: ["active", "done"] }).notNull().default("active"),
  createdByName: text("created_by_name").notNull().default("Equipe"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  completedAt: text("completed_at"),
});

export const onboardingItems = sqliteTable("onboarding_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  onboardingId: integer("onboarding_id").notNull().references(() => onboardings.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  done: integer("done", { mode: "boolean" }).notNull().default(false),
  doneByName: text("done_by_name"),
  doneAt: text("done_at"),
  sortOrder: real("sort_order").notNull().default(0),
}, (table) => [index("onboarding_items_idx").on(table.onboardingId)]);

/** Ciclo de avaliação (a cada 3 meses): período, critérios e situação. */
export const reviewCycles = sqliteTable("review_cycles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  status: text("status", { enum: ["open", "closed"] }).notNull().default("open"),
  // Critérios em JSON (lista de textos) para colegas, empresa e gestão.
  peerCriteria: text("peer_criteria").notNull().default("[]"),
  companyCriteria: text("company_criteria").notNull().default("[]"),
  managerCriteria: text("manager_criteria").notNull().default("[]"),
  createdByName: text("created_by_name").notNull().default("Equipe"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  closedAt: text("closed_at"),
});

/** Gestão avaliada por todos, só com nome e cargo (não precisam de usuário no Portal). */
export const reviewManagers = sqliteTable("review_managers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  title: text("title").notNull().default(""),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

/**
 * Respostas, sem ligação com quem respondeu (anônimas). Alvo: "member:ID", "manager:ID" ou "company".
 * Notas em JSON na ordem dos critérios do ciclo.
 */
export const reviewAnswers = sqliteTable("review_answers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  cycleId: integer("cycle_id").notNull().references(() => reviewCycles.id, { onDelete: "cascade" }),
  target: text("target").notNull(),
  scores: text("scores").notNull(),
  comment: text("comment").notNull().default(""),
  // Justificativa de cada nota, na mesma ordem dos critérios (JSON).
  notes: text("notes").notNull().default("[]"),
}, (table) => [index("review_answers_cycle_idx").on(table.cycleId, table.target)]);

/** Quem já avaliou quem em cada ciclo (só para não repetir e mostrar o que falta; não guarda as notas). */
export const reviewSubmissions = sqliteTable("review_submissions", {
  cycleId: integer("cycle_id").notNull().references(() => reviewCycles.id, { onDelete: "cascade" }),
  reviewerId: integer("reviewer_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  target: text("target").notNull(),
}, (table) => [primaryKey({ columns: [table.cycleId, table.reviewerId, table.target] })]);

/** Metas anuais do time ou individuais, com valor-alvo e progresso. */
export const goals = sqliteTable("goals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  year: integer("year").notNull(),
  scope: text("scope", { enum: ["team", "person"] }).notNull(),
  teamId: integer("team_id").references(() => teams.id, { onDelete: "cascade" }),
  memberId: integer("member_id").references(() => members.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  unit: text("unit").notNull().default(""),
  // "up": quanto mais, melhor (ex.: entregas); "down": quanto menos, melhor (ex.: chamados atrasados).
  direction: text("direction", { enum: ["up", "down"] }).notNull().default("up"),
  startValue: real("start_value").notNull().default(0),
  target: real("target").notNull(),
  current: real("current").notNull().default(0),
  // "number": progresso digitado; "checklist": a % sobe sozinha conforme os itens são concluídos.
  mode: text("mode", { enum: ["number", "checklist"] }).notNull().default("number"),
  createdByName: text("created_by_name").notNull().default("Equipe"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("goals_year_idx").on(table.year, table.scope)]);

/** Itens do checklist de uma meta (modo "checklist"). */
export const goalItems = sqliteTable("goal_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  goalId: integer("goal_id").notNull().references(() => goals.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  done: integer("done", { mode: "boolean" }).notNull().default(false),
  doneByName: text("done_by_name"),
  doneAt: text("done_at"),
  sortOrder: integer("sort_order").notNull().default(0),
  // Demanda ligada: o item é marcado (e desmarcado) sozinho quando ela é concluída (ou reaberta).
  taskId: integer("task_id").references(() => tasks.id, { onDelete: "set null" }),
}, (table) => [index("goal_items_goal_idx").on(table.goalId, table.sortOrder), index("goal_items_task_idx").on(table.taskId)]);

export const goalUpdates = sqliteTable("goal_updates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  goalId: integer("goal_id").notNull().references(() => goals.id, { onDelete: "cascade" }),
  value: real("value").notNull(),
  note: text("note").notNull().default(""),
  byName: text("by_name").notNull().default("Equipe"),
  at: text("at").notNull(),
}, (table) => [index("goal_updates_goal_idx").on(table.goalId)]);

/** Reunião 1:1 entre líder e liderado: pauta e anotações dos dois, e uma nota só do líder. */
export const oneOnOnes = sqliteTable("one_on_ones", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  leaderId: integer("leader_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  memberId: integer("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  date: text("date").notNull(),
  status: text("status", { enum: ["planned", "done"] }).notNull().default("planned"),
  agenda: text("agenda").notNull().default(""),
  notes: text("notes").notNull().default(""),
  privateNotes: text("private_notes").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("one_on_ones_member_idx").on(table.memberId, table.date), index("one_on_ones_leader_idx").on(table.leaderId, table.date)]);

/** Plano de desenvolvimento individual: ações ligadas (ou não) a um critério da avaliação. */
export const devActions = sqliteTable("dev_actions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  memberId: integer("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  criterion: text("criterion").notNull().default(""),
  description: text("description").notNull().default(""),
  dueDate: text("due_date"),
  status: text("status", { enum: ["todo", "doing", "done"] }).notNull().default("todo"),
  createdByName: text("created_by_name").notNull().default("Equipe"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  doneAt: text("done_at"),
}, (table) => [index("dev_actions_member_idx").on(table.memberId)]);

/** Pesquisa de clima do mês (AAAA-MM), com as perguntas daquele mês. */
export const pulseSurveys = sqliteTable("pulse_surveys", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  month: text("month").notNull(),
  questions: text("questions").notNull().default("[]"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("pulse_surveys_month_unique").on(table.month)]);

/** Respostas da pesquisa de clima, sem quem respondeu. */
export const pulseAnswers = sqliteTable("pulse_answers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  surveyId: integer("survey_id").notNull().references(() => pulseSurveys.id, { onDelete: "cascade" }),
  scores: text("scores").notNull(),
  comment: text("comment").notNull().default(""),
}, (table) => [index("pulse_answers_survey_idx").on(table.surveyId)]);

/** Quem já respondeu no mês (só para não repetir; não guarda as notas). */
export const pulseSubmissions = sqliteTable("pulse_submissions", {
  surveyId: integer("survey_id").notNull().references(() => pulseSurveys.id, { onDelete: "cascade" }),
  memberId: integer("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
}, (table) => [primaryKey({ columns: [table.surveyId, table.memberId] })]);

/** Equipamentos (notebook, monitor...) e licenças de software da empresa. */
export const assets = sqliteTable("assets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind", { enum: ["equipment", "license"] }).notNull(),
  name: text("name").notNull(),
  category: text("category").notNull().default(""),
  identifier: text("identifier").notNull().default(""),
  status: text("status", { enum: ["in_use", "available", "maintenance", "retired"] }).notNull().default("available"),
  seats: integer("seats").notNull().default(1),
  purchaseDate: text("purchase_date"),
  expiresOn: text("expires_on"),
  cost: real("cost"),
  notes: text("notes").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("assets_kind_idx").on(table.kind, table.status)]);

export const assetAssignments = sqliteTable("asset_assignments", {
  assetId: integer("asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
  memberId: integer("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  assignedAt: text("assigned_at").notNull(),
}, (table) => [primaryKey({ columns: [table.assetId, table.memberId] })]);

export const assetEvents = sqliteTable("asset_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  assetId: integer("asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  byName: text("by_name").notNull().default("Equipe"),
  at: text("at").notNull(),
}, (table) => [index("asset_events_asset_idx").on(table.assetId)]);

/** Incidente: sistema de cliente fora do ar ou problema grave, com causa e o que muda para não repetir. */
export const incidents = sqliteTable("incidents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  clientId: integer("client_id").references(() => clients.id, { onDelete: "set null" }),
  systemId: integer("system_id").references(() => clientSystems.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  severity: text("severity", { enum: ["low", "medium", "high", "critical"] }).notNull().default("medium"),
  status: text("status", { enum: ["open", "resolved", "analyzed"] }).notNull().default("open"),
  startedAt: text("started_at").notNull(),
  resolvedAt: text("resolved_at"),
  impact: text("impact").notNull().default(""),
  cause: text("cause").notNull().default(""),
  resolution: text("resolution").notNull().default(""),
  prevention: text("prevention").notNull().default(""),
  auto: integer("auto", { mode: "boolean" }).notNull().default(false),
  createdByName: text("created_by_name").notNull().default("Equipe"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("incidents_status_idx").on(table.status, table.startedAt), index("incidents_system_idx").on(table.systemId)]);

export const incidentUpdates = sqliteTable("incident_updates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  incidentId: integer("incident_id").notNull().references(() => incidents.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  byName: text("by_name").notNull().default("Equipe"),
  at: text("at").notNull(),
}, (table) => [index("incident_updates_incident_idx").on(table.incidentId)]);

/** Conversa: canal aberto a todos ou mensagem direta entre duas pessoas (dm_key "menorId:maiorId"). */
export const chatChannels = sqliteTable("chat_channels", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind", { enum: ["channel", "dm"] }).notNull().default("channel"),
  name: text("name").notNull(),
  topic: text("topic").notNull().default(""),
  teamId: integer("team_id").references(() => teams.id, { onDelete: "set null" }),
  dmKey: text("dm_key"),
  createdById: integer("created_by_id").references(() => members.id, { onDelete: "set null" }),
  createdByName: text("created_by_name").notNull().default("Equipe"),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  lastMessageAt: text("last_message_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("chat_channels_dm_unique").on(table.dmKey)]);

export const chatMessages = sqliteTable("chat_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  channelId: integer("channel_id").notNull().references(() => chatChannels.id, { onDelete: "cascade" }),
  topicId: integer("topic_id").references((): AnySQLiteColumn => chatTopics.id, { onDelete: "cascade" }),
  memberId: integer("member_id").references(() => members.id, { onDelete: "set null" }),
  authorName: text("author_name").notNull().default("Equipe"),
  body: text("body").notNull(),
  replyToId: integer("reply_to_id"),
  // Fotos e GIFs (JSON): [{ kind: "upload", key } | { kind: "gif", url, width, height }].
  attachments: text("attachments").notNull().default("[]"),
  editedAt: text("edited_at"),
  deleted: integer("deleted", { mode: "boolean" }).notNull().default(false),
  // Demanda criada a partir desta mensagem ("Virar demanda").
  taskId: integer("task_id").references(() => tasks.id, { onDelete: "set null" }),
  // Fixada no topo da conversa.
  pinnedAt: text("pinned_at"),
  pinnedByName: text("pinned_by_name"),
  // Enquete publicada nesta mensagem.
  pollId: integer("poll_id"),
  createdAt: text("created_at").notNull(),
}, (table) => [index("chat_messages_channel_idx").on(table.channelId, table.id), index("chat_messages_topic_idx").on(table.topicId, table.id)]);

export const chatReactions = sqliteTable("chat_reactions", {
  messageId: integer("message_id").notNull().references(() => chatMessages.id, { onDelete: "cascade" }),
  memberId: integer("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  emoji: text("emoji").notNull(),
}, (table) => [primaryKey({ columns: [table.messageId, table.memberId, table.emoji] })]);

/** Até onde cada pessoa leu cada conversa (para o contador de não lidas). */
export const chatReads = sqliteTable("chat_reads", {
  channelId: integer("channel_id").notNull().references(() => chatChannels.id, { onDelete: "cascade" }),
  memberId: integer("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  lastReadId: integer("last_read_id").notNull().default(0),
}, (table) => [primaryKey({ columns: [table.channelId, table.memberId] })]);


/** Presença nas conversas: visto por último (online) e em qual conversa está digitando. */
export const chatPresence = sqliteTable("chat_presence", {
  memberId: integer("member_id").primaryKey().references(() => members.id, { onDelete: "cascade" }),
  lastSeenAt: text("last_seen_at").notNull(),
  typingChannelId: integer("typing_channel_id"),
  typingTopicId: integer("typing_topic_id"),
  typingAt: text("typing_at"),
  // Status escolhido pela pessoa (meeting | lunch | client | away) e até quando vale (null = até tirar).
  statusKind: text("status_kind"),
  statusUntil: text("status_until"),
});

/** "Me lembre desta mensagem": o aviso vai para o sino na hora marcada. */
export const chatReminders = sqliteTable("chat_reminders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  memberId: integer("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  messageId: integer("message_id").notNull().references(() => chatMessages.id, { onDelete: "cascade" }),
  remindAt: text("remind_at").notNull(),
  firedAt: text("fired_at"),
  createdAt: text("created_at").notNull(),
}, (table) => [index("chat_reminders_due_idx").on(table.memberId, table.firedAt, table.remindAt), uniqueIndex("chat_reminders_message_idx").on(table.memberId, table.messageId)]);

/** Assunto de uma conversa: no canal, cada tema tem o seu (com título e "resolvido"); na conversa direta há um só. */
export const chatTopics = sqliteTable("chat_topics", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  channelId: integer("channel_id").notNull().references(() => chatChannels.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  resolved: integer("resolved", { mode: "boolean" }).notNull().default(false),
  createdById: integer("created_by_id").references(() => members.id, { onDelete: "set null" }),
  createdByName: text("created_by_name").notNull().default("Equipe"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  lastMessageAt: text("last_message_at"),
}, (table) => [index("chat_topics_channel_idx").on(table.channelId, table.lastMessageAt)]);

/**
 * Chaves para outros sistemas usarem a API do Portal (hoje: o agente N1 do AtendeChat).
 * Só o hash da chave fica salvo; a chave aparece uma única vez, ao ser criada.
 */
export const integrationKeys = sqliteTable("integration_keys", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  // "atendechat" (agente N1) ou "export" (leitura dos dados pelo Power BI/Excel).
  kind: text("kind", { enum: ["atendechat", "export"] }).notNull().default("atendechat"),
  keyHash: text("key_hash").notNull(),
  keyPrefix: text("key_prefix").notNull(),
  // Time que recebe os chamados abertos pela integração.
  teamId: integer("team_id").references(() => teams.id, { onDelete: "set null" }),
  // Só artigos da base com esta etiqueta podem ser lidos pela integração (o resto é interno).
  kbTag: text("kb_tag").notNull().default("n1"),
  createdByName: text("created_by_name").notNull().default("Equipe"),
  createdAt: text("created_at").notNull(),
  lastUsedAt: text("last_used_at"),
  revokedAt: text("revoked_at"),
}, (table) => [uniqueIndex("integration_keys_hash_unique").on(table.keyHash)]);

/** Pedidos da equipe para a Copa ("podia ter adoçante"): os outros apoiam e quem cuida das compras decide. */
export const copaRequests = sqliteTable("copa_requests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  note: text("note").notNull().default(""),
  status: text("status", { enum: ["open", "approved", "declined"] }).notNull().default("open"),
  // Item do estoque ligado ao pedido aprovado (novo ou já existente).
  itemId: integer("item_id").references(() => items.id, { onDelete: "set null" }),
  createdById: integer("created_by_id").references(() => members.id, { onDelete: "set null" }),
  createdByName: text("created_by_name").notNull().default("Equipe"),
  decidedByName: text("decided_by_name"),
  decisionNote: text("decision_note").notNull().default(""),
  decidedAt: text("decided_at"),
  createdAt: text("created_at").notNull(),
}, (table) => [index("copa_requests_status_idx").on(table.status, table.createdAt)]);

export const copaRequestVotes = sqliteTable("copa_request_votes", {
  requestId: integer("request_id").notNull().references(() => copaRequests.id, { onDelete: "cascade" }),
  memberId: integer("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
}, (table) => [primaryKey({ columns: [table.requestId, table.memberId] })]);

/** Até onde cada pessoa leu cada assunto (contador de não lidas). */
export const chatTopicReads = sqliteTable("chat_topic_reads", {
  topicId: integer("topic_id").notNull().references(() => chatTopics.id, { onDelete: "cascade" }),
  memberId: integer("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  lastReadId: integer("last_read_id").notNull().default(0),
}, (table) => [primaryKey({ columns: [table.topicId, table.memberId] })]);

/** Entregas (marcos) de um projeto, mostradas como losangos na linha do tempo. */
export const projectMilestones = sqliteTable("project_milestones", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  date: text("date").notNull(),
  done: integer("done", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
}, (table) => [index("project_milestones_project_idx").on(table.projectId, table.date)]);

/** Dependência entre projetos: o projeto (projectId) só começa depois que o outro (dependsOnId) terminar. */
export const projectDependencies = sqliteTable("project_dependencies", {
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  dependsOnId: integer("depends_on_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
}, (table) => [primaryKey({ columns: [table.projectId, table.dependsOnId] })]);

/** Enquete rápida no chat (channelId) ou no mural (channelId null). Opções em JSON. */
export const polls = sqliteTable("polls", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  question: text("question").notNull(),
  options: text("options").notNull().default("[]"),
  multiple: integer("multiple", { mode: "boolean" }).notNull().default(false),
  anonymous: integer("anonymous", { mode: "boolean" }).notNull().default(false),
  channelId: integer("channel_id").references(() => chatChannels.id, { onDelete: "cascade" }),
  createdById: integer("created_by_id").references(() => members.id, { onDelete: "set null" }),
  createdByName: text("created_by_name").notNull().default("Equipe"),
  closesAt: text("closes_at"),
  closedAt: text("closed_at"),
  createdAt: text("created_at").notNull(),
}, (table) => [index("polls_channel_idx").on(table.channelId, table.createdAt)]);

export const pollVotes = sqliteTable("poll_votes", {
  pollId: integer("poll_id").notNull().references(() => polls.id, { onDelete: "cascade" }),
  memberId: integer("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  option: integer("option").notNull(),
}, (table) => [primaryKey({ columns: [table.pollId, table.memberId, table.option] })]);

/** Elogio público a um colega: aparece no mural, no perfil e na avaliação. */
export const kudos = sqliteTable("kudos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  fromId: integer("from_id").references(() => members.id, { onDelete: "set null" }),
  fromName: text("from_name").notNull().default("Equipe"),
  toId: integer("to_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  value: text("value").notNull().default(""),
  message: text("message").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [index("kudos_to_idx").on(table.toId, table.createdAt), index("kudos_created_idx").on(table.createdAt)]);

/** Mensagem do chat escrita agora para sair depois ("segunda às 9h"). */
export const chatScheduled = sqliteTable("chat_scheduled", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  memberId: integer("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  channelId: integer("channel_id").notNull().references(() => chatChannels.id, { onDelete: "cascade" }),
  topicId: integer("topic_id").references(() => chatTopics.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  sendAt: text("send_at").notNull(),
  sentAt: text("sent_at"),
  messageId: integer("message_id"),
  error: text("error"),
  createdAt: text("created_at").notNull(),
}, (table) => [index("chat_scheduled_due_idx").on(table.sentAt, table.sendAt), index("chat_scheduled_member_idx").on(table.memberId)]);

/** Pedido de manutenção do escritório ("ar-condicionado pingando"), com acompanhamento. */
export const maintenanceRequests = sqliteTable("maintenance_requests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  location: text("location").notNull().default(""),
  category: text("category").notNull().default("other"),
  priority: text("priority", { enum: ["low", "normal", "high", "urgent"] }).notNull().default("normal"),
  status: text("status", { enum: ["open", "in_progress", "waiting", "done", "canceled"] }).notNull().default("open"),
  createdById: integer("created_by_id").references(() => members.id, { onDelete: "set null" }),
  createdByName: text("created_by_name").notNull().default("Equipe"),
  assigneeId: integer("assignee_id").references(() => members.id, { onDelete: "set null" }),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  resolvedAt: text("resolved_at"),
}, (table) => [index("maintenance_status_idx").on(table.status, table.createdAt)]);

export const maintenanceUpdates = sqliteTable("maintenance_updates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  requestId: integer("request_id").notNull().references(() => maintenanceRequests.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  byName: text("by_name").notNull().default("Equipe"),
  at: text("at").notNull(),
}, (table) => [index("maintenance_updates_request_idx").on(table.requestId)]);

/** Aparelhos que recebem avisos no celular/computador (Web Push). */
export const pushSubscriptions = sqliteTable("push_subscriptions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  memberId: integer("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull(),
  device: text("device").notNull().default(""),
  failCount: integer("fail_count").notNull().default(0),
  createdAt: text("created_at").notNull(),
  lastOkAt: text("last_ok_at"),
}, (table) => [uniqueIndex("push_subscriptions_endpoint_unique").on(table.endpoint), index("push_subscriptions_member_idx").on(table.memberId)]);

/** Segunda etapa do login: depois da senha certa, falta o código do celular (vale 5 minutos). */
export const loginChallenges = sqliteTable("login_challenges", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  memberId: integer("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  attempts: integer("attempts").notNull().default(0),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [uniqueIndex("login_challenges_token_unique").on(table.tokenHash)]);

/** Lugares (país/cidade + navegador) de onde cada pessoa já entrou, para avisar de acesso de um lugar novo. */
export const loginPlaces = sqliteTable("login_places", {
  memberId: integer("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  place: text("place").notNull(),
  firstSeenAt: text("first_seen_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
}, (table) => [primaryKey({ columns: [table.memberId, table.place] })]);

/** Resumo automático (IA) de um chamado, guardado para não gerar de novo sem necessidade. */
export const ticketSummaries = sqliteTable("ticket_summaries", {
  ticketId: integer("ticket_id").primaryKey().references(() => tickets.id, { onDelete: "cascade" }),
  summary: text("summary").notNull(),
  // Quantos registros (comentários e mudanças) o chamado tinha quando o resumo foi feito.
  basedOn: integer("based_on").notNull().default(0),
  createdAt: text("created_at").notNull(),
});
