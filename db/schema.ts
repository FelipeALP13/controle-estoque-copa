import { sql } from "drizzle-orm";
import { integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
  workedHours: real("worked_hours"),
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

/** Códigos das planilhas antigas (AS-0019, JG-0001...), para busca e para não importar duas vezes. */
export const taskLegacyCodes = sqliteTable("task_legacy_codes", {
  code: text("code").primaryKey(),
  taskId: integer("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
});

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
});

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
});

export const notifications = sqliteTable("notifications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  memberId: integer("member_id")
    .notNull()
    .references(() => members.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["task_assigned", "task_comment", "task_mention", "task_status", "ticket_new", "ticket_assigned", "ticket_comment", "ticket_mention", "ticket_status"] }).notNull(),
  taskId: integer("task_id").references(() => tasks.id, { onDelete: "cascade" }),
  ticketId: integer("ticket_id").references(() => tickets.id, { onDelete: "cascade" }),
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
