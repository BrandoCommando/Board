import { relations, sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const boards = sqliteTable("boards", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const strokes = sqliteTable("strokes", {
  id: text("id").primaryKey(),
  boardId: text("board_id")
    .notNull()
    .references(() => boards.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  payload: text("payload", { mode: "json" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const usersRelations = relations(users, ({ many }) => ({
  strokes: many(strokes),
}));

export const boardsRelations = relations(boards, ({ many }) => ({
  strokes: many(strokes),
}));

export const strokesRelations = relations(strokes, ({ one }) => ({
  board: one(boards, {
    fields: [strokes.boardId],
    references: [boards.id],
  }),
  user: one(users, {
    fields: [strokes.userId],
    references: [users.id],
  }),
}));
