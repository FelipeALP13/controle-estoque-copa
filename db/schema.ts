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
