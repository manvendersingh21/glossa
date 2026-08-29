import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Pool } from "pg";
import { pointInDowntown } from "./geo";
import type { PreparedData } from "./pipeline";
import type { LoadedSources } from "./types";

type TimingKind = "current_official" | "stale_official" | "observed" | "modeled" | "unknown";
type Confidence = "high" | "medium" | "low" | "unknown";

interface ExportRow {
  id: string;
  cnn: string;
  signalNumber: string | null;
  name: string;
  longitude: number;
  latitude: number;
  downtown: boolean;
  type: string | null;
  detection: string | null;
  vehicleActuated: boolean | null;
  pedestrianSignal: boolean | null;
  pedestrianActuated: boolean | null;
  accessiblePedestrianSignal: boolean | null;
  transitPriority: boolean | null;
  emergencyPreemption: boolean | null;
  redLightCamera: boolean | null;
  osmComponentCount: number;
  timingKind: TimingKind;
  cycleSeconds: number | null;
  cycleMinSeconds: number | null;
  cycleMaxSeconds: number | null;
  confidence: Confidence;
  modelVersion: string | null;
  rationale: string[];
  sourceUrl: string | null;
  sourceAsOf: string | null;
  inventoryAsOf: string | null;
  osmAsOf: string | null;
}

const CSV_COLUMNS: Array<[string, keyof ExportRow]> = [
  ["id", "id"],
  ["cnn", "cnn"],
  ["signal_number", "signalNumber"],
  ["name", "name"],
  ["longitude", "longitude"],
  ["latitude", "latitude"],
  ["downtown", "downtown"],
  ["type", "type"],
  ["detection", "detection"],
  ["vehicle_actuated", "vehicleActuated"],
  ["pedestrian_signal", "pedestrianSignal"],
  ["pedestrian_actuated", "pedestrianActuated"],
  ["accessible_pedestrian_signal", "accessiblePedestrianSignal"],
  ["transit_priority", "transitPriority"],
  ["emergency_preemption", "emergencyPreemption"],
  ["red_light_camera", "redLightCamera"],
  ["osm_component_count", "osmComponentCount"],
  ["timing_kind", "timingKind"],
  ["cycle_seconds", "cycleSeconds"],
  ["cycle_min_seconds", "cycleMinSeconds"],
  ["cycle_max_seconds", "cycleMaxSeconds"],
  ["confidence", "confidence"],
  ["model_version", "modelVersion"],
  ["rationale", "rationale"],
  ["source_url", "sourceUrl"],
  ["source_as_of", "sourceAsOf"],
  ["inventory_as_of", "inventoryAsOf"],
  ["osm_as_of", "osmAsOf"],
];

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const raw = Array.isArray(value) ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

export function rowsToCsv(rows: ExportRow[]): string {
  return [
    CSV_COLUMNS.map(([label]) => label).join(","),
    ...rows.map((row) => CSV_COLUMNS.map(([, key]) => csvCell(row[key])).join(",")),
  ].join("\n") + "\n";
}

function featureCollection(rows: ExportRow[], generatedAt: Date, sources: unknown[]) {
  return {
    type: "FeatureCollection",
    features: rows.map((row) => ({
      type: "Feature",
      id: row.id,
      geometry: { type: "Point", coordinates: [row.longitude, row.latitude] },
      properties: {
        id: row.id,
        cnn: row.cnn,
        signalNumber: row.signalNumber,
        name: row.name,
        downtown: row.downtown,
        type: row.type,
        detection: row.detection,
        vehicleActuated: row.vehicleActuated,
        pedestrianSignal: row.pedestrianSignal,
        pedestrianActuated: row.pedestrianActuated,
        accessiblePedestrianSignal: row.accessiblePedestrianSignal,
        transitPriority: row.transitPriority,
        emergencyPreemption: row.emergencyPreemption,
        redLightCamera: row.redLightCamera,
        osmComponentCount: row.osmComponentCount,
        timing: {
          kind: row.timingKind,
          cycleSeconds: row.cycleSeconds,
          cycleRangeSeconds: row.cycleMinSeconds === null || row.cycleMaxSeconds === null
            ? null
            : [row.cycleMinSeconds, row.cycleMaxSeconds],
          cyclesPerHourRange: row.cycleMinSeconds === null || row.cycleMaxSeconds === null
            ? null
            : [3600 / row.cycleMaxSeconds, 3600 / row.cycleMinSeconds],
          confidence: row.confidence,
          modelVersion: row.modelVersion,
          rationale: row.rationale,
          sourceUrl: row.sourceUrl,
          sourceAsOf: row.sourceAsOf,
        },
        inventoryAsOf: row.inventoryAsOf,
        osmAsOf: row.osmAsOf,
      },
    })),
    meta: {
      count: rows.length,
      nextCursor: null,
      generatedAt: generatedAt.toISOString(),
      sources,
      attribution: [
        "San Francisco Municipal Transportation Agency / DataSF",
        "San Francisco Planning Department",
        "City and County of San Francisco / DataSF",
        "© OpenStreetMap contributors (ODbL)",
      ],
      timingCaveat: "The current DataSF inventory publishes no cycle, phase, or live state. Unknown timing remains explicit until separate evidence is imported.",
    },
  };
}

async function atomicWrite(filePath: string, body: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, body, "utf8");
  await rename(temporaryPath, filePath);
}

export interface ExportPaths {
  geojson: string;
  csv: string;
  matchReport?: string;
  downtownGeojson?: string;
}

export async function writeSnapshotExports(
  sources: LoadedSources,
  prepared: PreparedData,
  outputDirectory = process.env.EXPORT_DIR ?? "data/exports",
): Promise<ExportPaths> {
  const componentCount = new Map<string, number>();
  for (const { match } of prepared.osmComponents) {
    if (match.status === "matched" && match.intersectionCnn) {
      componentCount.set(match.intersectionCnn, (componentCount.get(match.intersectionCnn) ?? 0) + 1);
    }
  }
  const osmAsOf = (sources.osm.sourceUpdatedAt ?? sources.osm.fetchedAt).toISOString();
  const unknownRationale = [
    "No cycle or phase timing is published by the current DataSF Traffic Signals inventory, and no separate timing evidence was loaded in snapshot-only mode.",
  ];
  const rows: ExportRow[] = prepared.intersections.map((intersection) => ({
    id: intersection.cnn,
    cnn: intersection.cnn,
    signalNumber: intersection.signalNumber,
    name: intersection.name,
    longitude: intersection.coordinates[0],
    latitude: intersection.coordinates[1],
    downtown: pointInDowntown(intersection.coordinates, prepared.downtownPolygons),
    type: intersection.type,
    detection: intersection.detection,
    vehicleActuated: intersection.vehicleActuated,
    pedestrianSignal: intersection.pedestrianSignal,
    pedestrianActuated: intersection.pedestrianActuated,
    accessiblePedestrianSignal: intersection.accessiblePedestrianSignal,
    transitPriority: intersection.transitPriority,
    emergencyPreemption: intersection.emergencyPreemption,
    redLightCamera: intersection.redLightCamera,
    osmComponentCount: componentCount.get(intersection.cnn) ?? 0,
    timingKind: "unknown",
    cycleSeconds: null,
    cycleMinSeconds: null,
    cycleMaxSeconds: null,
    confidence: "unknown",
    modelVersion: null,
    rationale: unknownRationale,
    sourceUrl: null,
    sourceAsOf: null,
    inventoryAsOf: intersection.inventoryAsOf?.toISOString() ?? null,
    osmAsOf,
  }));
  const generatedAt = new Date();
  const sourceMeta = Object.values(sources).map((source) => ({
    name: source.sourceKey,
    asOf: source.sourceUpdatedAt?.toISOString() ?? null,
    url: source.sourceUrl,
    sha256: source.sha256,
    archivePath: source.archivePath,
  }));
  const geojsonPath = path.resolve(outputDirectory, "signals.geojson");
  const csvPath = path.resolve(outputDirectory, "signals.csv");
  const matchReportPath = path.resolve(outputDirectory, "osm-match-report.csv");
  const downtownPath = path.resolve(outputDirectory, "downtown-c3.geojson");
  const matchReport = [
    "osm_type,osm_id,status,confidence,intersection_cnn,distance_m,street_overlap,score,nearby_streets,candidates",
    ...prepared.osmComponents.map(({ component, match }) => [
      component.osmType,
      component.osmId,
      match.status,
      match.confidence,
      match.intersectionCnn,
      match.distanceM,
      match.streetOverlap,
      match.score,
      component.nearbyStreets,
      match.candidates,
    ].map(csvCell).join(",")),
  ].join("\n") + "\n";
  const downtownGeojson = {
    type: "FeatureCollection",
    features: prepared.downtownPolygons.map((polygon) => ({
      type: "Feature",
      id: polygon.objectId,
      geometry: polygon.geometry,
      properties: {
        objectid: polygon.objectId,
        zoning_sim: polygon.zoningCode,
        districtname: polygon.districtName,
        source_last_edited_at: polygon.sourceLastEditedAt?.toISOString() ?? null,
      },
    })),
    meta: { definition: "Union input: all SF Planning layer 3 zoning_sim C-3% polygons", generatedAt: generatedAt.toISOString() },
  };
  await Promise.all([
    atomicWrite(geojsonPath, JSON.stringify(featureCollection(rows, generatedAt, sourceMeta))),
    atomicWrite(csvPath, rowsToCsv(rows)),
    atomicWrite(matchReportPath, matchReport),
    atomicWrite(downtownPath, JSON.stringify(downtownGeojson)),
  ]);
  return { geojson: geojsonPath, csv: csvPath, matchReport: matchReportPath, downtownGeojson: downtownPath };
}

interface DatabaseRow {
  id: string;
  cnn: string;
  signal_number: string | null;
  name: string;
  longitude: number;
  latitude: number;
  downtown: boolean;
  type: string | null;
  detection: string | null;
  vehicle_actuated: boolean | null;
  pedestrian_signal: boolean | null;
  pedestrian_actuated: boolean | null;
  accessible_pedestrian_signal: boolean | null;
  transit_priority: boolean | null;
  emergency_preemption: boolean | null;
  red_light_camera: boolean | null;
  osm_component_count: number;
  timing_kind: TimingKind;
  cycle_seconds: number | null;
  cycle_min_seconds: number | null;
  cycle_max_seconds: number | null;
  confidence: Confidence;
  model_version: string | null;
  rationale: string[];
  source_url: string | null;
  source_as_of: Date | null;
  inventory_as_of: Date | null;
  osm_as_of: Date | null;
}

export async function writeDatabaseExports(
  pool: Pool,
  outputDirectory = process.env.EXPORT_DIR ?? "data/exports",
): Promise<ExportPaths> {
  const result = await pool.query<DatabaseRow>(`
    SELECT id, cnn, signal_number, name, longitude, latitude, downtown, type, detection,
      vehicle_actuated, pedestrian_signal, pedestrian_actuated,
      accessible_pedestrian_signal, transit_priority, emergency_preemption,
      red_light_camera, osm_component_count, timing_kind, cycle_seconds,
      cycle_min_seconds, cycle_max_seconds, confidence, model_version, rationale,
      source_url, source_as_of, inventory_as_of, osm_as_of
    FROM signal_catalog ORDER BY cnn
  `);
  const rows: ExportRow[] = result.rows.map((row) => ({
    id: row.id,
    cnn: row.cnn,
    signalNumber: row.signal_number,
    name: row.name,
    longitude: Number(row.longitude),
    latitude: Number(row.latitude),
    downtown: row.downtown,
    type: row.type,
    detection: row.detection,
    vehicleActuated: row.vehicle_actuated,
    pedestrianSignal: row.pedestrian_signal,
    pedestrianActuated: row.pedestrian_actuated,
    accessiblePedestrianSignal: row.accessible_pedestrian_signal,
    transitPriority: row.transit_priority,
    emergencyPreemption: row.emergency_preemption,
    redLightCamera: row.red_light_camera,
    osmComponentCount: row.osm_component_count,
    timingKind: row.timing_kind,
    cycleSeconds: row.cycle_seconds === null ? null : Number(row.cycle_seconds),
    cycleMinSeconds: row.cycle_min_seconds === null ? null : Number(row.cycle_min_seconds),
    cycleMaxSeconds: row.cycle_max_seconds === null ? null : Number(row.cycle_max_seconds),
    confidence: row.confidence,
    modelVersion: row.model_version,
    rationale: row.rationale,
    sourceUrl: row.source_url,
    sourceAsOf: row.source_as_of?.toISOString() ?? null,
    inventoryAsOf: row.inventory_as_of?.toISOString() ?? null,
    osmAsOf: row.osm_as_of?.toISOString() ?? null,
  }));
  const snapshots = await pool.query<{
    source_key: string;
    source_url: string;
    source_updated_at: Date | null;
    sha256: string;
    archive_path: string;
  }>(`
    SELECT DISTINCT ON (source_key)
      source_key, source_url, source_updated_at, sha256, archive_path
    FROM source_snapshots ORDER BY source_key, fetched_at DESC
  `);
  const generatedAt = new Date();
  const sources = snapshots.rows.map((snapshot) => ({
    name: snapshot.source_key,
    asOf: snapshot.source_updated_at?.toISOString() ?? null,
    url: snapshot.source_url,
    sha256: snapshot.sha256,
    archivePath: snapshot.archive_path,
  }));
  const geojsonPath = path.resolve(outputDirectory, "signals.geojson");
  const csvPath = path.resolve(outputDirectory, "signals.csv");
  await Promise.all([
    atomicWrite(geojsonPath, JSON.stringify(featureCollection(rows, generatedAt, sources))),
    atomicWrite(csvPath, rowsToCsv(rows)),
  ]);
  return { geojson: geojsonPath, csv: csvPath };
}

