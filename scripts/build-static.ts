import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { prepareData } from "../lib/data/pipeline";
import { writeSnapshotExports } from "../lib/data/exports";
import { parseJsonForScript } from "../lib/data/static-source";
import type { GeoJsonFeatureCollection, LoadedSources, OverpassResponse, SnapshotPayload } from "../lib/data/types";

async function latestJson(sourceKey: string): Promise<{ body: string; archivePath: string }> {
  const directory = path.resolve("data/raw", sourceKey);
  const entries = (await readdir(directory)).filter((entry) => entry.endsWith(".json")).sort().reverse();
  if (!entries[0]) throw new Error(`No archived snapshot found for ${sourceKey}`);
  const archivePath = path.relative(process.cwd(), path.join(directory, entries[0]));
  return { body: await readFile(path.join(directory, entries[0]), "utf8"), archivePath };
}

function snapshot<T>(sourceKey: string, sourceUrl: string, body: string, archivePath: string, data: T): SnapshotPayload<T> {
  return {
    sourceKey, sourceUrl, fetchedAt: new Date(), sourceUpdatedAt: null,
    contentType: "application/geo+json", sha256: createHash("sha256").update(body).digest("hex"),
    byteCount: Buffer.byteLength(body), rowCount: Array.isArray((data as { features?: unknown[] }).features)
      ? ((data as { features: unknown[] }).features.length) : ((data as OverpassResponse).elements?.length ?? 0),
    archivePath, request: { mode: "offline-archive" }, response: { cache: "offline" }, data, fromCache: true,
  };
}

async function main(): Promise<void> {
  const signals = await latestJson("datasf-traffic-signals");
  const streets = await latestJson("datasf-streets");
  const downtown = await latestJson("sfplanning-c3-zoning");
  const emptyOsm: OverpassResponse = { elements: [] };
  const sources: LoadedSources = {
    signals: snapshot("datasf-traffic-signals", "https://data.sfgov.org/resource/ybh5-27n2.geojson", signals.body, signals.archivePath, parseJsonForScript<GeoJsonFeatureCollection>(signals.body)),
    streets: snapshot("datasf-streets", "https://data.sfgov.org/resource/3psu-pn9h.geojson", streets.body, streets.archivePath, parseJsonForScript<GeoJsonFeatureCollection>(streets.body)),
    downtown: snapshot("sfplanning-c3-zoning", "https://sfplanninggis.org/arcgiswa/rest/services/PlanningData/MapServer/3", downtown.body, downtown.archivePath, parseJsonForScript<GeoJsonFeatureCollection>(downtown.body)),
    osm: snapshot("openstreetmap-signals", "https://www.openstreetmap.org/relation/111968", JSON.stringify(emptyOsm), "offline (Overpass unavailable)", emptyOsm),
  };
  const prepared = prepareData(sources);
  const exports = await writeSnapshotExports(sources, prepared);
  console.log(JSON.stringify({ intersections: prepared.intersections.length, downtownPolygons: prepared.downtownPolygons.length, exports }, null, 2));
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
