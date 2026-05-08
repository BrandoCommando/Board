import { relations } from "drizzle-orm";
import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("User"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const boards = pgTable("boards", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const strokes = pgTable("strokes", {
  id: text("id").primaryKey(),
  boardId: text("board_id")
    .notNull()
    .references(() => boards.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
