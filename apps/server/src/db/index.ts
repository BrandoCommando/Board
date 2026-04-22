import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

export type DbClient = ReturnType<typeof createDb>;

export function createDb(databaseUrl: string) {
  const sqlite = new Database(databaseUrl);
  sqlite.pragma("journal_mode = WAL");
  return drizzle(sqlite, { schema });
}
