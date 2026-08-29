import { readFile } from "node:fs/promises";
import { createDatabasePool } from "../lib/data/db";
import { importTimingCards, parseTimingCards } from "../lib/data/timing-cards";

async function main(): Promise<void> {
  const filePath = process.argv.find((argument) => !argument.startsWith("--") && argument !== process.argv[0] && argument !== process.argv[1]);
  if (!filePath) {
    throw new Error("Usage: npm run data:timings -- <timing-cards.csv> [--validate-only]");
  }
  if (process.argv.includes("--validate-only")) {
    const rows = parseTimingCards(await readFile(filePath, "utf8"));
    process.stdout.write(`Validated ${rows.length} timing rows\n`);
    return;
  }
  const pool = createDatabasePool();
  try {
    const result = await importTimingCards(pool, filePath);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

