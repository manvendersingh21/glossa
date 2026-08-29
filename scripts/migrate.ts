import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createDatabasePool } from "../lib/data/db";

async function main(): Promise<void> {
  const pool = createDatabasePool();
  const migrationsDirectory = path.resolve("db/migrations");
  const files = (await readdir(migrationsDirectory))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  try {
    for (const filename of files) {
      const exists = await pool.query("SELECT 1 FROM schema_migrations WHERE filename=$1", [filename]);
      if (exists.rowCount) continue;
      const sql = await readFile(path.join(migrationsDirectory, filename), "utf8");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [filename]);
        await client.query("COMMIT");
        process.stdout.write(`Applied ${filename}\n`);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

