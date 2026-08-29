import type {
  Confidence,
  SignalFeature,
  SignalFeatureCollection,
  TimingKind,
} from "@/lib/contracts";
import { ApiError } from "@/lib/server/api-error";
import { decodeCursor, encodeCursor } from "@/lib/server/cursor";
import { query } from "@/lib/server/db";
import type {
  Capability,
  ExportQuery,
  SignalFilters,
} from "@/lib/server/filters";
import { getSourceMetadata, PUBLIC_ATTRIBUTION } from "@/lib/server/sources";
import { getStaticSignals } from "@/lib/server/static-data";

const CAPABILITY_COLUMNS: Record<Capability, string> = {
  vehicleActuated: "vehicle_actuated",
  pedestrianSignal: "pedestrian_signal",
  pedestrianActuated: "pedestrian_actuated",
  accessiblePedestrianSignal: "accessible_pedestrian_signal",
  transitPriority: "transit_priority",
  emergencyPreemption: "emergency_preemption",
  redLightCamera: "red_light_camera",
};

const SIGNAL_COLUMNS = `
  s.id,
  s.cnn,
  s.signal_number,
  s.name,
  s.longitude,
  s.latitude,
  s.downtown,
  s.type,
  s.detection,
  s.vehicle_actuated,
  s.pedestrian_signal,
  s.pedestrian_actuated,
  s.accessible_pedestrian_signal,
  s.transit_priority,
  s.emergency_preemption,
  s.red_light_camera,
  s.osm_component_count,
  s.timing_kind,
  s.cycle_seconds,
  s.cycle_min_seconds,
  s.cycle_max_seconds,
  s.confidence,
  s.model_version,
  s.rationale,
  s.source_url,
  s.source_as_of,
  s.inventory_as_of,
  s.osm_as_of
`;

export interface ParameterizedQuery {
  text: string;
  values: unknown[];
}

interface SignalRow {
  id: string;
  cnn: string;
  signal_number: string | null;
  name: string;
  longitude: number | string;
  latitude: number | string;
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
  osm_component_count: number | string | null;
  timing_kind: TimingKind | null;
  cycle_seconds: number | string | null;
  cycle_min_seconds: number | string | null;
  cycle_max_seconds: number | string | null;
  confidence: Confidence | null;
  model_version: string | null;
  rationale: unknown;
  source_url: string | null;
  source_as_of: string | Date | null;
  inventory_as_of: string | Date | null;
  osm_as_of: string | Date | null;
}

interface QueryFilterInput {
  bbox?: [number, number, number, number];
  downtown?: boolean;
  timingKind?: TimingKind;
  capability?: Capability;
  cursor?: string;
}

function addValue(values: unknown[], value: unknown): string {
  values.push(value);
  return `$${values.length}`;
}

function whereForFilters(
  filters: QueryFilterInput,
  values: unknown[],
): string[] {
  const conditions: string[] = [];

  if (filters.bbox) {
    const [west, south, east, north] = filters.bbox;
    const placeholders = [west, south, east, north].map((value) =>
      addValue(values, value),
    );
    const envelope = `ST_MakeEnvelope(${placeholders.join(", ")}, 4326)`;
    conditions.push(`s.geometry && ${envelope}`);
    conditions.push(`ST_Intersects(s.geometry, ${envelope})`);
  }
  if (filters.downtown !== undefined) {
    conditions.push(`s.downtown = ${addValue(values, filters.downtown)}`);
  }
  if (filters.timingKind !== undefined) {
    conditions.push(`s.timing_kind = ${addValue(values, filters.timingKind)}`);
  }
  if (filters.capability !== undefined) {
    conditions.push(`s.${CAPABILITY_COLUMNS[filters.capability]} IS TRUE`);
  }
  if (filters.cursor !== undefined) {
    conditions.push(`s.id > ${addValue(values, decodeCursor(filters.cursor))}`);
  }

  return conditions;
}

export function buildSignalsQuery(filters: SignalFilters): ParameterizedQuery {
  const values: unknown[] = [];
  const conditions = whereForFilters(filters, values);
  const limit = addValue(values, filters.limit + 1);

  return {
    text: `
      SELECT ${SIGNAL_COLUMNS}
      FROM public.signal_catalog AS s
      ${conditions.length > 0 ? `WHERE ${conditions.join("\n        AND ")}` : ""}
      ORDER BY s.id ASC
      LIMIT ${limit}
    `,
    values,
  };
}

export function buildExportQuery(
  filters: ExportQuery,
  maximumRows: number,
): ParameterizedQuery {
  const values: unknown[] = [];
  const conditions = whereForFilters(filters, values);
  const limit = addValue(values, maximumRows + 1);

  return {
    text: `
      SELECT ${SIGNAL_COLUMNS}
      FROM public.signal_catalog AS s
      ${conditions.length > 0 ? `WHERE ${conditions.join("\n        AND ")}` : ""}
      ORDER BY s.id ASC
      LIMIT ${limit}
    `,
    values,
  };
}

export function buildSignalByIdQuery(id: string): ParameterizedQuery {
  return {
    text: `
      SELECT ${SIGNAL_COLUMNS}
      FROM public.signal_catalog AS s
      WHERE s.id = $1
      LIMIT 1
    `,
    values: [id],
  };
}

function nullableNumber(value: number | string | null): number | null {
  if (value === null) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sourceDate(value: string | Date | null): string | null {
  if (value === null) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : value;
}

function rationale(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  return [];
}

function cyclesPerHourRange(
  minimumCycle: number | null,
  maximumCycle: number | null,
  nominalCycle: number | null,
): [number, number] | null {
  if (
    minimumCycle !== null &&
    maximumCycle !== null &&
    minimumCycle > 0 &&
    maximumCycle > 0
  ) {
    return [
      Number((3_600 / maximumCycle).toFixed(1)),
      Number((3_600 / minimumCycle).toFixed(1)),
    ];
  }

  if (nominalCycle !== null && nominalCycle > 0) {
    const cycles = Number((3_600 / nominalCycle).toFixed(1));
    return [cycles, cycles];
  }

  return null;
}

export function rowToSignalFeature(row: SignalRow): SignalFeature {
  const longitude = Number(row.longitude);
  const latitude = Number(row.latitude);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    throw new ApiError(
      500,
      "invalid_data",
      "A stored signal has invalid coordinates.",
    );
  }

  const minimumCycle = nullableNumber(row.cycle_min_seconds);
  const maximumCycle = nullableNumber(row.cycle_max_seconds);
  const nominalCycle = nullableNumber(row.cycle_seconds);
  const cycleRange: [number, number] | null =
    minimumCycle !== null && maximumCycle !== null
      ? [minimumCycle, maximumCycle]
      : null;

  return {
    type: "Feature",
    id: row.id,
    geometry: { type: "Point", coordinates: [longitude, latitude] },
    properties: {
      id: row.id,
      cnn: row.cnn,
      signalNumber: row.signal_number,
      name: row.name,
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
      osmComponentCount: Number(row.osm_component_count ?? 0),
      timing: {
        kind: row.timing_kind ?? "unknown",
        cycleSeconds: nominalCycle,
        cycleRangeSeconds: cycleRange,
        cyclesPerHourRange: cyclesPerHourRange(
          minimumCycle,
          maximumCycle,
          nominalCycle,
        ),
        confidence: row.confidence ?? "unknown",
        modelVersion: row.model_version,
        rationale: rationale(row.rationale),
        sourceUrl: row.source_url,
        sourceAsOf: sourceDate(row.source_as_of),
      },
      inventoryAsOf: sourceDate(row.inventory_as_of),
      osmAsOf: sourceDate(row.osm_as_of),
    },
  };
}

export async function getSignals(
  filters: SignalFilters,
): Promise<SignalFeatureCollection> {
  const statement = buildSignalsQuery(filters);
  let rows: SignalRow[];
  let sources: Awaited<ReturnType<typeof getSourceMetadata>>;
  try {
    [rows, sources] = await Promise.all([query<SignalRow>(statement.text, statement.values), getSourceMetadata()]);
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== "database_unavailable") throw error;
    return getStaticSignals(filters);
  }
  const hasNextPage = rows.length > filters.limit;
  const page = hasNextPage ? rows.slice(0, filters.limit) : rows;
  const features = page.map(rowToSignalFeature);

  return {
    type: "FeatureCollection",
    features,
    meta: {
      count: features.length,
      nextCursor:
        hasNextPage && features.length > 0
          ? encodeCursor(features[features.length - 1].id)
          : null,
      generatedAt: new Date().toISOString(),
      sources,
      attribution: [...PUBLIC_ATTRIBUTION],
    },
  };
}

export async function getSignalById(id: string): Promise<SignalFeature> {
  const statement = buildSignalByIdQuery(id);
  const rows = await query<SignalRow>(statement.text, statement.values);
  if (!rows[0]) {
    throw new ApiError(404, "not_found", "No signal exists with that id.");
  }
  return rowToSignalFeature(rows[0]);
}

export async function getSignalsForExport(
  filters: ExportQuery,
  maximumRows: number,
): Promise<SignalFeatureCollection> {
  const statement = buildExportQuery(filters, maximumRows);
  const [rows, sources] = await Promise.all([
    query<SignalRow>(statement.text, statement.values),
    getSourceMetadata(),
  ]);

  if (rows.length > maximumRows) {
    throw new ApiError(
      413,
      "export_too_large",
      "The export is too large. Add bbox or other filters and try again.",
    );
  }

  const features = rows.map(rowToSignalFeature);
  return {
    type: "FeatureCollection",
    features,
    meta: {
      count: features.length,
      nextCursor: null,
      generatedAt: new Date().toISOString(),
      sources,
      attribution: [...PUBLIC_ATTRIBUTION],
    },
  };
}
