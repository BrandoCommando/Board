import "dotenv/config";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { defineConfig } from "drizzle-kit";

const raw = process.env.DATABASE_URL ?? "./data/app.sqlite";
const filePath = raw.startsWith("file:") ? raw.slice("file:".length) : raw;
const resolved = resolve(filePath);
mkdirSync(dirname(resolved), { recursive: true });

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: resolved,
  },
});
