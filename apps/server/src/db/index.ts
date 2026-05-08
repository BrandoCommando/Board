import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

export type DbClient = ReturnType<typeof createDb>;

export function createDb(databaseUrl: string) {
  const pool = new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS ?? 8000),
    idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS ?? 10000),
    max: Number(process.env.PG_POOL_MAX ?? 2),
    allowExitOnIdle: true,
    query_timeout: Number(process.env.PG_QUERY_TIMEOUT_MS ?? 10000),
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
