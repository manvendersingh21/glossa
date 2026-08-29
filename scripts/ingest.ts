import { createDatabasePool } from "../lib/data/db";
import { writeDatabaseExports, writeSnapshotExports } from "../lib/data/exports";
import { prepareData } from "../lib/data/pipeline";
import { loadPreparedData } from "../lib/data/repository";
import { fetchAllSources, SnapshotArchive } from "../lib/data/sources";

async function main(): Promise<void> {
  const snapshotOnly = process.argv.includes("--snapshot-only")
    || process.env.INGEST_SNAPSHOT_ONLY === "true";
  const archive = new SnapshotArchive();
  const sources = await fetchAllSources(archive);
  const prepared = prepareData(sources);

  if (snapshotOnly) {
    const paths = await writeSnapshotExports(sources, prepared);
    process.stdout.write(`${JSON.stringify({
      mode: "snapshot-only",
      intersections: prepared.intersections.length,
      streets: prepared.streets.length,
      downtownPolygons: prepared.downtownPolygons.length,
      osmComponents: prepared.osmComponents.length,
      matched: prepared.osmComponents.filter(({ match }) => match.status === "matched").length,
      ambiguous: prepared.osmComponents.filter(({ match }) => match.status === "ambiguous").length,
      unmatched: prepared.osmComponents.filter(({ match }) => match.status === "unmatched").length,
      exports: paths,
    }, null, 2)}\n`);
    return;
  }

  const pool = createDatabasePool();
  try {
    const counts = await loadPreparedData(pool, sources, prepared);
    const exports = await writeDatabaseExports(pool);
    process.stdout.write(`${JSON.stringify({ mode: "database", ...counts, exports }, null, 2)}\n`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

