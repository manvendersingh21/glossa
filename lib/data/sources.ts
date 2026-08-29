import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  assertFeatureCollection,
  assertOverpassResponse,
  downtownSourceAsOf,
  parseDowntownPolygons,
  parseStreetSegments,
  parseTrafficSignals,
  signalSourceAsOf,
  streetSourceAsOf,
} from "./parsers";
import type {
  GeoJsonFeatureCollection,
  JsonObject,
  LoadedSources,
  OverpassResponse,
  SnapshotPayload,
} from "./types";

export const SOURCE_URLS = {
  signals: "https://data.sfgov.org/resource/ybh5-27n2.geojson",
  streets: "https://data.sfgov.org/resource/3psu-pn9h.geojson",
  downtownLayer: "https://sfplanninggis.org/arcgiswa/rest/services/PlanningData/MapServer/3",
  overpassAttribution: "https://www.openstreetmap.org/relation/111968",
} as const;

export const OVERPASS_QUERY = `[out:json][timeout:180];
rel(111968)->.sf_relation;
map_to_area.sf_relation->.sf_area;
nwr["highway"="traffic_signals"](area.sf_area)->.signals;
way(around.signals:45)["highway"]["name"]->.roads;
(.signals;.roads;);
out center geom tags;`;

interface FetchOptions {
  method?: "GET" | "POST";
  headers?: HeadersInit;
  body?: BodyInit;
  attempts?: number;
  timeoutMs?: number;
}

interface RawFetch {
  body: string;
  contentType: string;
  response: JsonObject;
}

export class SnapshotArchive {
  readonly root: string;
  readonly maxPerSource: number;
  readonly maxAgeDays: number;

  constructor(options: { root?: string; maxPerSource?: number; maxAgeDays?: number } = {}) {
    this.root = path.resolve(options.root ?? process.env.RAW_ARCHIVE_DIR ?? "data/raw");
    this.maxPerSource = options.maxPerSource ?? Number(process.env.RAW_RETENTION_COUNT ?? 14);
    this.maxAgeDays = options.maxAgeDays ?? Number(process.env.RAW_RETENTION_DAYS ?? 90);
    if (!Number.isInteger(this.maxPerSource) || this.maxPerSource < 1) {
      throw new Error("RAW_RETENTION_COUNT must be a positive integer");
    }
    if (!Number.isFinite(this.maxAgeDays) || this.maxAgeDays <= 0) {
      throw new Error("RAW_RETENTION_DAYS must be positive");
    }
  }

  private sourceDirectory(sourceKey: string): string {
    if (!/^[a-z0-9-]+$/.test(sourceKey)) throw new Error(`Unsafe source key: ${sourceKey}`);
    return path.join(this.root, sourceKey);
  }

  async save(
    sourceKey: string,
    body: string,
    fetchedAt: Date,
    extension: "json" | "csv" = "json",
  ): Promise<{ path: string; sha256: string }> {
    const directory = this.sourceDirectory(sourceKey);
    await mkdir(directory, { recursive: true });
    const sha256 = createHash("sha256").update(body).digest("hex");
    const timestamp = fetchedAt.toISOString().replace(/[:.]/g, "-");
    const absolutePath = path.join(directory, `${timestamp}-${sha256.slice(0, 12)}.${extension}`);
    await writeFile(absolutePath, body, { encoding: "utf8", flag: "wx" }).catch(async (error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    });
    await this.prune(sourceKey);
    return { path: path.relative(process.cwd(), absolutePath), sha256 };
  }

  async readFresh(sourceKey: string, maxAgeMs: number): Promise<{ body: string; path: string; fetchedAt: Date } | null> {
    const directory = this.sourceDirectory(sourceKey);
    let entries: string[];
    try {
      entries = (await readdir(directory)).filter((entry) => entry.endsWith(".json")).sort().reverse();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry);
      const details = await stat(absolutePath);
      if (Date.now() - details.mtimeMs <= maxAgeMs) {
        return {
          body: await readFile(absolutePath, "utf8"),
          path: path.relative(process.cwd(), absolutePath),
          fetchedAt: details.mtime,
        };
      }
    }
    return null;
  }

  async prune(sourceKey: string): Promise<void> {
    const directory = this.sourceDirectory(sourceKey);
    const entries = (await readdir(directory).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [] as string[];
      throw error;
    })).filter((entry) => entry.endsWith(".json") || entry.endsWith(".csv"));
    const files = await Promise.all(entries.map(async (entry) => {
      const absolutePath = path.join(directory, entry);
      const details = await stat(absolutePath);
      return { absolutePath, mtimeMs: details.mtimeMs };
    }));
    files.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const cutoff = Date.now() - this.maxAgeDays * 86_400_000;
    await Promise.all(files.flatMap((file, index) =>
      index >= this.maxPerSource || (index > 0 && file.mtimeMs < cutoff)
        ? [unlink(file.absolutePath)]
        : []));
  }
}

function retryDelayMs(attempt: number, retryAfter: string | null): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.min(30_000, Math.max(0, seconds * 1000));
  }
  return Math.min(15_000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function fetchWithRetry(url: string, options: FetchOptions = {}): Promise<RawFetch> {
  const attempts = options.attempts ?? 4;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 210_000);
    try {
      const response = await fetch(url, {
        method: options.method ?? "GET",
        headers: options.headers,
        body: options.body,
        signal: controller.signal,
      });
      const body = await response.text();
      if (response.ok) {
        return {
          body,
          contentType: response.headers.get("content-type") ?? "application/json",
          response: {
            status: response.status,
            etag: response.headers.get("etag"),
            lastModified: response.headers.get("last-modified"),
          },
        };
      }
      const retryable = response.status === 408
        || response.status === 429
        || [500, 502, 503, 504].includes(response.status);
      if (!retryable || attempt === attempts - 1) {
        throw new Error(`HTTP ${response.status} from ${url}: ${body.slice(0, 300)}`);
      }
      await wait(retryDelayMs(attempt, response.headers.get("retry-after")));
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) throw error;
      await wait(retryDelayMs(attempt, null));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Unable to fetch ${url}`);
}

function parseJson(body: string, source: string): unknown {
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error(`${source} returned invalid JSON`, { cause: error });
  }
}

async function archivePayload<T>(options: {
  archive: SnapshotArchive;
  sourceKey: string;
  sourceUrl: string;
  fetchedAt: Date;
  sourceUpdatedAt: Date | null;
  body: string;
  contentType: string;
  rowCount: number;
  request: JsonObject;
  response: JsonObject;
  data: T;
  fromCache?: boolean;
  existingPath?: string;
}): Promise<SnapshotPayload<T>> {
  const saved = options.existingPath
    ? {
        path: options.existingPath,
        sha256: createHash("sha256").update(options.body).digest("hex"),
      }
    : await options.archive.save(options.sourceKey, options.body, options.fetchedAt);
  return {
    sourceKey: options.sourceKey,
    sourceUrl: options.sourceUrl,
    fetchedAt: options.fetchedAt,
    sourceUpdatedAt: options.sourceUpdatedAt,
    contentType: options.contentType,
    sha256: saved.sha256,
    byteCount: Buffer.byteLength(options.body),
    rowCount: options.rowCount,
    archivePath: saved.path,
    request: options.request,
    response: options.response,
    data: options.data,
    fromCache: options.fromCache ?? false,
  };
}

async function fetchSocrata(options: {
  archive: SnapshotArchive;
  sourceKey: "datasf-traffic-signals" | "datasf-streets";
  sourceUrl: string;
}): Promise<SnapshotPayload<GeoJsonFeatureCollection>> {
  const pageSize = 5_000;
  const features: GeoJsonFeatureCollection["features"] = [];
  let offset = 0;
  let lastResponse: JsonObject = {};
  do {
    const url = new URL(options.sourceUrl);
    url.searchParams.set("$limit", String(pageSize));
    url.searchParams.set("$offset", String(offset));
    url.searchParams.set("$order", options.sourceKey === "datasf-traffic-signals" ? "cnn" : "cnn");
    const headers: HeadersInit = {};
    if (process.env.DATASF_APP_TOKEN) headers["X-App-Token"] = process.env.DATASF_APP_TOKEN;
    const fetched = await fetchWithRetry(url.toString(), { headers, timeoutMs: 120_000 });
    const page = assertFeatureCollection(parseJson(fetched.body, options.sourceKey), options.sourceKey);
    features.push(...page.features);
    lastResponse = fetched.response;
    offset += page.features.length;
    if (page.features.length < pageSize) break;
  } while (true);
  const collection: GeoJsonFeatureCollection = { type: "FeatureCollection", features };
  const body = JSON.stringify(collection);
  const fetchedAt = new Date();
  const sourceUpdatedAt = options.sourceKey === "datasf-traffic-signals"
    ? signalSourceAsOf(parseTrafficSignals(collection))
    : streetSourceAsOf(parseStreetSegments(collection));
  return archivePayload({
    archive: options.archive,
    sourceKey: options.sourceKey,
    sourceUrl: options.sourceUrl,
    fetchedAt,
    sourceUpdatedAt,
    body,
    contentType: "application/geo+json",
    rowCount: features.length,
    request: { pagination: { pageSize, order: "cnn" } },
    response: lastResponse,
    data: collection,
  });
}

async function fetchDowntown(archive: SnapshotArchive): Promise<SnapshotPayload<GeoJsonFeatureCollection>> {
  const queryUrl = new URL(`${SOURCE_URLS.downtownLayer}/query`);
  queryUrl.searchParams.set("where", "zoning_sim LIKE 'C-3%'");
  queryUrl.searchParams.set("outFields", "objectid,zoning_sim,districtname,last_edit");
  queryUrl.searchParams.set("returnGeometry", "true");
  queryUrl.searchParams.set("outSR", "4326");
  queryUrl.searchParams.set("f", "geojson");
  const fetched = await fetchWithRetry(queryUrl.toString(), { timeoutMs: 120_000 });
  const collection = assertFeatureCollection(parseJson(fetched.body, "sfplanning-c3-zoning"), "sfplanning-c3-zoning");
  const rows = parseDowntownPolygons(collection);
  if (!rows.length) throw new Error("SF Planning C-3 query returned no valid polygons");
  const fetchedAt = new Date();
  return archivePayload({
    archive,
    sourceKey: "sfplanning-c3-zoning",
    sourceUrl: queryUrl.toString(),
    fetchedAt,
    sourceUpdatedAt: downtownSourceAsOf(rows),
    body: fetched.body,
    contentType: fetched.contentType,
    rowCount: rows.length,
    request: { where: "zoning_sim LIKE 'C-3%'", layer: 3, outSR: 4326 },
    response: fetched.response,
    data: collection,
  });
}

async function fetchOverpass(archive: SnapshotArchive): Promise<SnapshotPayload<OverpassResponse>> {
  const sourceKey = "openstreetmap-signals";
  const endpoints = process.env.OVERPASS_ENDPOINT
    ? [process.env.OVERPASS_ENDPOINT]
    : [
        "https://overpass.kumi.systems/api/interpreter",
        "https://overpass-api.de/api/interpreter",
      ];
  const cacheHours = Number(process.env.OVERPASS_CACHE_HOURS ?? 24);
  const cached = cacheHours > 0
    ? await archive.readFresh(sourceKey, cacheHours * 3_600_000)
    : null;
  if (cached) {
    const response = assertOverpassResponse(parseJson(cached.body, sourceKey));
    const sourceUpdatedAt = response.osm3s?.timestamp_osm_base
      ? new Date(response.osm3s.timestamp_osm_base)
      : null;
    return archivePayload({
      archive,
      sourceKey,
      sourceUrl: SOURCE_URLS.overpassAttribution,
      fetchedAt: cached.fetchedAt,
      sourceUpdatedAt,
      body: cached.body,
      contentType: "application/json",
      rowCount: response.elements.length,
      request: { method: "POST", endpoint: "cached", query: OVERPASS_QUERY, cacheHours },
      response: { cache: "hit" },
      data: response,
      fromCache: true,
      existingPath: cached.path,
    });
  }
  const failures: string[] = [];
  let endpoint = endpoints[0];
  let fetched: RawFetch | null = null;
  for (const candidate of endpoints) {
    endpoint = candidate;
    try {
      fetched = await fetchWithRetry(candidate, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
        body: new URLSearchParams({ data: OVERPASS_QUERY }),
        attempts: 3,
        timeoutMs: 240_000,
      });
      break;
    } catch (error) {
      failures.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!fetched) {
    if (process.env.INGEST_ALLOW_EMPTY_OSM === "true") {
      const body = JSON.stringify({ elements: [] });
      return archivePayload({
        archive,
        sourceKey,
        sourceUrl: SOURCE_URLS.overpassAttribution,
        fetchedAt: new Date(),
        sourceUpdatedAt: null,
        body,
        contentType: "application/json",
        rowCount: 0,
        request: { method: "POST", endpoint: "unavailable", query: OVERPASS_QUERY, cacheHours },
        response: { cache: "fallback-empty", failures },
        data: { elements: [] },
      });
    }
    throw new Error(`All Overpass endpoints failed:\n${failures.join("\n")}`);
  }
  const response = assertOverpassResponse(parseJson(fetched.body, sourceKey));
  const fetchedAt = new Date();
  const sourceUpdatedAt = response.osm3s?.timestamp_osm_base
    ? new Date(response.osm3s.timestamp_osm_base)
    : null;
  return archivePayload({
    archive,
    sourceKey,
    sourceUrl: SOURCE_URLS.overpassAttribution,
    fetchedAt,
    sourceUpdatedAt,
    body: fetched.body,
    contentType: fetched.contentType,
    rowCount: response.elements.length,
    request: { method: "POST", endpoint, query: OVERPASS_QUERY, cacheHours },
    response: fetched.response,
    data: response,
  });
}

export async function fetchAllSources(archive = new SnapshotArchive()): Promise<LoadedSources> {
  const [signals, streets, downtown, osm] = await Promise.all([
    fetchSocrata({
      archive,
      sourceKey: "datasf-traffic-signals",
      sourceUrl: SOURCE_URLS.signals,
    }),
    fetchSocrata({
      archive,
      sourceKey: "datasf-streets",
      sourceUrl: SOURCE_URLS.streets,
    }),
    fetchDowntown(archive),
    fetchOverpass(archive),
  ]);
  return { signals, streets, downtown, osm };
}
