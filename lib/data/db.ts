import { Pool } from "pg";

export function createDatabasePool(databaseUrl = process.env.DATABASE_URL): Pool {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for database ingestion; use --snapshot-only to fetch and export without Postgres");
  }
  return new Pool({
    connectionString: databaseUrl,
    max: Number(process.env.DATABASE_POOL_SIZE ?? 5),
    statement_timeout: Number(process.env.DATABASE_STATEMENT_TIMEOUT_MS ?? 300_000),
  });
}

