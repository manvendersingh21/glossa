import { Pool, type QueryResultRow } from "pg";

import { ApiError } from "@/lib/server/api-error";

declare global {
  var glossaDatabasePool: Pool | undefined;
}

function makePool(): Pool {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new ApiError(
      503,
      "database_unavailable",
      "The database is not configured.",
    );
  }

  return new Pool({
    connectionString,
    application_name: "glossa-web",
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 10_000,
    query_timeout: 12_000,
  });
}

export function getPool(): Pool {
  globalThis.glossaDatabasePool ??= makePool();
  return globalThis.glossaDatabasePool;
}

export async function query<Row extends QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
): Promise<Row[]> {
  try {
    const result = await getPool().query<Row>(text, [...values]);
    return result.rows;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    console.error("Database query failed", {
      cause: error instanceof Error ? error.message : "unknown error",
    });
    throw new ApiError(
      503,
      "database_unavailable",
      "The data service is temporarily unavailable.",
    );
  }
}
