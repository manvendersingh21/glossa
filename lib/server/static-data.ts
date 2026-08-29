import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AreaStats, SignalFeature, SignalFeatureCollection } from "@/lib/contracts";
import { encodeCursor, decodeCursor } from "@/lib/server/cursor";
import type { Capability, ExportQuery, SignalFilters } from "@/lib/server/filters";
import { area as turfArea } from "@turf/turf";

const STATIC_PATH = path.resolve(process.env.GLOSSA_STATIC_EXPORT ?? "data/exports/signals.geojson");
const SF_AREA = 46.91;
const CAPABILITY_KEYS: Record<Capability, keyof SignalFeature["properties"]> = {
  vehicleActuated: "vehicleActuated", pedestrianSignal: "pedestrianSignal", pedestrianActuated: "pedestrianActuated",
  accessiblePedestrianSignal: "accessiblePedestrianSignal", transitPriority: "transitPriority",
  emergencyPreemption: "emergencyPreemption", redLightCamera: "redLightCamera",
};

async function load(): Promise<SignalFeatureCollection> {
  const body = await readFile(STATIC_PATH, "utf8");
  return JSON.parse(body) as SignalFeatureCollection;
}

function matches(feature: SignalFeature, filters: SignalFilters | ExportQuery): boolean {
  const p = feature.properties;
  if (filters.downtown !== undefined && p.downtown !== filters.downtown) return false;
  if (filters.timingKind !== undefined && p.timing.kind !== filters.timingKind) return false;
  if (filters.capability !== undefined && p[CAPABILITY_KEYS[filters.capability]] !== true) return false;
  if (filters.bbox) {
    const [west, south, east, north] = filters.bbox;
    const [longitude, latitude] = feature.geometry.coordinates;
    if (longitude < west || longitude > east || latitude < south || latitude > north) return false;
  }
  return true;
}

export async function getStaticSignals(filters: SignalFilters): Promise<SignalFeatureCollection> {
  const collection = await load();
  let features = collection.features.filter((feature) => matches(feature, filters)).sort((a, b) => a.id.localeCompare(b.id));
  if (filters.cursor) features = features.filter((feature) => feature.id > decodeCursor(filters.cursor!));
  const page = features.slice(0, filters.limit);
  return {
    type: "FeatureCollection", features: page,
    meta: { ...collection.meta, count: page.length, nextCursor: features.length > page.length && page.length ? encodeCursor(page[page.length - 1].id) : null, generatedAt: new Date().toISOString() },
  };
}

export async function getStaticStats(area: "sf" | "downtown"): Promise<AreaStats> {
  const collection = await load();
  const points = collection.features.filter((feature) => area === "sf" || feature.properties.downtown);
  let areaSquareMiles = SF_AREA;
  if (area === "downtown") {
    try {
      const zoning = JSON.parse(await readFile(path.resolve("data/exports/downtown-c3.geojson"), "utf8")) as { features?: Array<{ type: "Feature"; geometry: never }> };
      const squareMeters = (zoning.features ?? []).reduce((sum, feature) => sum + turfArea(feature as never), 0);
      if (squareMeters > 0) areaSquareMiles = squareMeters / 2_589_988.110336;
    } catch {
      areaSquareMiles = Math.max(1, points.length / 110);
    }
  }
  const distances: number[] = [];
  for (let i = 0; i < points.length; i += 1) {
    let nearest = Number.POSITIVE_INFINITY;
    for (let j = 0; j < points.length; j += 1) if (i !== j) {
      const [aLon, aLat] = points[i].geometry.coordinates; const [bLon, bLat] = points[j].geometry.coordinates;
      const dx = (aLon - bLon) * 288200; const dy = (aLat - bLat) * 364000;
      nearest = Math.min(nearest, Math.hypot(dx, dy));
    }
    if (Number.isFinite(nearest)) distances.push(nearest);
  }
  distances.sort((a, b) => a - b);
  return {
    area, signalCount: points.length, areaSquareMiles,
    roadMiles: 0, signalsPerSquareMile: Number((points.length / areaSquareMiles).toFixed(2)), signalsPerRoadMile: 0,
    medianNearestSignalFeet: distances.length ? Number(distances[Math.floor(distances.length / 2)].toFixed(1)) : null,
    timingCoveragePercent: 0, officialTimingPercent: 0, modeledTimingPercent: 0, generatedAt: new Date().toISOString(),
  };
}

export async function getStaticSources() {
  const collection = await load();
  return (collection.meta.sources ?? []).map((source) => ({
    key: source.name,
    name: source.name,
    url: source.url,
    attribution: source.name === "openstreetmap-signals" ? "OpenStreetMap contributors" : "City and County of San Francisco",
    license: source.name === "openstreetmap-signals" ? "ODbL 1.0" : null,
    expectedRefresh: null,
    capabilities: {},
    limitations: source.name === "openstreetmap-signals" ? ["Overpass was unavailable when this offline snapshot was generated."] : [],
    fetchedAt: null,
    asOf: source.asOf,
    rowCount: null,
  }));
}
