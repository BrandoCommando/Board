import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

export type DbClient = ReturnType<typeof createDb>;

export function createDb(databaseUrl: string) {
  const pool = new Pool({
    connectionString: databaseUrl,
    // Most hosted Postgres providers used on Vercel require TLS.
    ssl:
      process.env.PGSSLMODE === "disable"
        ? false
        : {
            rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED === "true",
          },
  });
  return drizzle(pool, { schema });
}
