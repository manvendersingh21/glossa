import { readFile } from "node:fs/promises";
import path from "node:path";
import { createDatabasePool } from "../lib/data/db";
import {
  importSfmtaTimingDocument,
  parseSfmtaTimingDocument,
} from "../lib/data/sfmta-timing-parser";
import { importTimingCards, parseTimingCards } from "../lib/data/timing-cards";

function positionalArgument(): string | undefined {
  return process.argv.find(
    (argument) => !argument.startsWith("--") && argument !== process.argv[0] && argument !== process.argv[1],
  );
}

/**
 * Import a reviewed SFMTA timing document (`...reviewed.json`) into the
 * `signal_timing_*` tables, or validate it without a database when
 * `--validate-only` is set. Format is selected by file extension so the
 * existing CSV timing-card path is unchanged.
 */
async function importReviewedDocument(filePath: string, validateOnly: boolean): Promise<void> {
  const document = parseSfmtaTimingDocument(await readFile(filePath, "utf8"));
  if (validateOnly) {
    process.stdout.write(
      `Validated reviewed SFMTA timing document ${document.importKey}`
      + ` (CNN ${document.intersection.cnn}, ${document.evidenceKind}):`
      + ` ${document.plans.length} plan(s)\n`,
    );
    return;
  }
  const pool = createDatabasePool();
  try {
    const result = await importSfmtaTimingDocument(pool, document);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await pool.end();
  }
}

async function importTimingCardCsv(filePath: string, validateOnly: boolean): Promise<void> {
  if (validateOnly) {
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

async function main(): Promise<void> {
  const filePath = positionalArgument();
  if (!filePath) {
    throw new Error(
      "Usage: npm run data:timings -- <timing-cards.csv | reviewed-timing.json> [--validate-only]",
    );
  }
  const validateOnly = process.argv.includes("--validate-only");
  switch (path.extname(filePath).toLowerCase()) {
    case ".json":
      await importReviewedDocument(filePath, validateOnly);
      return;
    case ".csv":
      await importTimingCardCsv(filePath, validateOnly);
      return;
    default:
      throw new Error(
        `Unsupported timing-data file extension "${path.extname(filePath)}": use a .csv timing-card file or a .json reviewed SFMTA timing document.`,
      );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
