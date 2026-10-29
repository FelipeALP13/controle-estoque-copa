import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

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

export const members = sqliteTable("members", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull().unique(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  role: text("role", { enum: ["admin", "member", "viewer"] }).notNull().default("member"),
  permissions: text("permissions").notNull().default("{}"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  avatarIcon: text("avatar_icon").notNull().default("👤"),
  avatarKey: text("avatar_key"),
  username: text("username").unique(),
  passwordHash: text("password_hash"),
  passwordSalt: text("password_salt"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

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
