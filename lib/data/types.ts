export type JsonObject = Record<string, unknown>;

export interface PointGeometry {
  type: "Point";
  coordinates: [number, number];
}

export interface GeoJsonGeometry {
  type: string;
  coordinates: unknown;
}

export interface GeoJsonFeature {
  type: "Feature";
  id?: string | number;
  geometry: GeoJsonGeometry | null;
  properties: JsonObject | null;
}

export interface GeoJsonFeatureCollection {
  type: "FeatureCollection";
  features: GeoJsonFeature[];
  [key: string]: unknown;
}

export interface SnapshotPayload<T> {
  sourceKey: string;
  sourceUrl: string;
  fetchedAt: Date;
  sourceUpdatedAt: Date | null;
  contentType: string;
  sha256: string;
  byteCount: number;
  rowCount: number;
  archivePath: string;
  request: JsonObject;
  response: JsonObject;
  data: T;
  fromCache: boolean;
}

export interface NormalizedIntersection {
  cnn: string;
  objectId: string | null;
  signalNumber: string | null;
  name: string;
  streetNames: string[];
  normalizedStreets: string[];
  type: string | null;
  detection: string | null;
  vehicleActuated: boolean | null;
  pedestrianSignal: boolean | null;
  pedestrianActuated: boolean | null;
  accessiblePedestrianSignal: boolean | null;
  transitPriority: boolean | null;
  emergencyPreemption: boolean | null;
  redLightCamera: boolean | null;
  coordinates: [number, number];
  inventoryAsOf: Date | null;
  dataLoadedAt: Date | null;
  rawProperties: JsonObject;
}

export interface NormalizedStreetSegment {
  cnn: string;
  streetName: string;
  normalizedStreetName: string;
  fromStreet: string | null;
  toStreet: string | null;
  fromNodeCnn: string | null;
  toNodeCnn: string | null;
  classCode: number | null;
  active: boolean;
  layer: string | null;
  geometry: GeoJsonGeometry;
  sourceAsOf: Date | null;
  dataLoadedAt: Date | null;
  rawProperties: JsonObject;
}

export interface DowntownPolygon {
  objectId: number;
  zoningCode: string;
  districtName: string | null;
  sourceLastEditedAt: Date | null;
  geometry: GeoJsonGeometry;
  rawProperties: JsonObject;
}

export interface OsmSignalComponent {
  osmType: "node" | "way" | "relation";
  osmId: number;
  coordinates: [number, number];
  tags: Record<string, string>;
  nearbyStreets: string[];
  normalizedStreets: string[];
}

export interface MatchCandidate {
  cnn: string;
  distanceM: number;
  streetOverlap: number;
  streetCoverage: number;
  score: number;
}

export interface ComponentMatch {
  status: "matched" | "ambiguous" | "unmatched";
  confidence: "high" | "medium" | "low" | "unknown";
  method: string;
  intersectionCnn: string | null;
  distanceM: number | null;
  streetOverlap: number;
  score: number | null;
  candidates: MatchCandidate[];
}

export interface OverpassResponse {
  version?: number;
  generator?: string;
  osm3s?: { timestamp_osm_base?: string; copyright?: string };
  elements: Array<{
    type: "node" | "way" | "relation";
    id: number;
    lat?: number;
    lon?: number;
    center?: { lat: number; lon: number };
    tags?: Record<string, string>;
    geometry?: Array<{ lat: number; lon: number }>;
  }>;
}

export interface LoadedSources {
  signals: SnapshotPayload<GeoJsonFeatureCollection>;
  streets: SnapshotPayload<GeoJsonFeatureCollection>;
  downtown: SnapshotPayload<GeoJsonFeatureCollection>;
  osm: SnapshotPayload<OverpassResponse>;
}

