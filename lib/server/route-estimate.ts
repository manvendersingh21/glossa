import { z } from "zod";
import { ApiError } from "@/lib/server/api-error";
import { query } from "@/lib/server/db";

const pointSchema = z.object({
  address: z.string().trim().min(2).max(300).optional(),
  latitude: z.number().finite().min(-90).max(90).optional(),
  longitude: z.number().finite().min(-180).max(180).optional(),
}).refine((value) => value.address || (value.latitude !== undefined && value.longitude !== undefined), {
  message: "Provide an address or latitude and longitude.",
});

export const routeEstimateRequestSchema = z.object({
  origin: pointSchema,
  destination: pointSchema,
  departureTime: z.string().datetime({ offset: true }).optional(),
});

type PointInput = z.infer<typeof pointSchema>;

interface GoogleRouteResponse {
  routes?: Array<{
    duration?: string;
    staticDuration?: string;
    distanceMeters?: number;
    polyline?: { encodedPolyline?: string };
  }>;
  error?: { message?: string };
}

interface RouteSignalRow {
  cnn: string;
  name: string;
  longitude: number | string;
  latitude: number | string;
  timing_kind: string | null;
  cycle_seconds: number | string | null;
  cycle_min_seconds: number | string | null;
  cycle_max_seconds: number | string | null;
  confidence: string | null;
  vehicle_actuated: boolean | null;
  pedestrian_actuated: boolean | null;
  transit_priority: boolean | null;
  distance_meters: number | string;
  route_position: number | string;
}

export interface RouteEstimate {
  route: { distanceMeters: number; durationSeconds: number; staticDurationSeconds: number; delaySeconds: number; encodedPolyline: string };
  signals: Array<{
    cnn: string;
    name: string;
    coordinates: [number, number];
    distanceMeters: number;
    timingKind: string;
    cycleSeconds: number | null;
    cycleRangeSeconds: [number, number] | null;
    confidence: string;
    vehicleActuated: boolean | null;
    pedestrianActuated: boolean | null;
    transitPriority: boolean | null;
  }>;
  estimate: {
    likelySignalStops: [number, number];
    likelySignalDelaySeconds: [number, number];
    confidence: "low" | "medium";
    explanation: string;
  };
  departureTime: string;
}

function googleLocation(point: PointInput): Record<string, unknown> {
  if (point.address) return { address: point.address };
  return { location: { latLng: { latitude: point.latitude, longitude: point.longitude } } };
}

function parseDuration(value: string | undefined): number {
  const match = value?.match(/^(\d+(?:\.\d+)?)s$/);
  return match ? Number(match[1]) : 0;
}

function decodePolyline(encoded: string): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;
  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte = 0;
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    latitude += (result & 1) ? ~(result >> 1) : result >> 1;
    result = 0;
    shift = 0;
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    longitude += (result & 1) ? ~(result >> 1) : result >> 1;
    points.push([longitude / 1e5, latitude / 1e5]);
  }
  return points;
}

function routeLineGeoJson(encodedPolyline: string): string {
  const coordinates = decodePolyline(encodedPolyline);
  if (coordinates.length < 2) throw new ApiError(502, "route_unavailable", "Google returned an unusable route.");
  return JSON.stringify({ type: "LineString", coordinates });
}

function numberOrNull(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function estimateRoute(input: z.infer<typeof routeEstimateRequestSchema>): Promise<RouteEstimate> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey || apiKey.includes("replace_me")) throw new ApiError(503, "route_unavailable", "Google Maps routing is not configured.");

  // Google requires an explicitly supplied departure time to be in the future;
  // one minute is close enough to represent leaving now without racing the API.
  const departureTime = input.departureTime ?? new Date(Date.now() + 60_000).toISOString();
  const response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "routes.duration,routes.staticDuration,routes.distanceMeters,routes.polyline.encodedPolyline",
    },
    body: JSON.stringify({
      origin: googleLocation(input.origin),
      destination: googleLocation(input.destination),
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE_OPTIMAL",
      departureTime,
      languageCode: "en-US",
      units: "IMPERIAL",
    }),
  });
  const body = (await response.json()) as GoogleRouteResponse;
  if (!response.ok || !body.routes?.[0]) throw new ApiError(502, "route_unavailable", body.error?.message ?? "Google could not calculate this route.");
  const route = body.routes[0];
  const encodedPolyline = route.polyline?.encodedPolyline;
  if (!encodedPolyline) throw new ApiError(502, "route_unavailable", "Google returned no route geometry.");

  const durationSeconds = parseDuration(route.duration);
  const staticDurationSeconds = parseDuration(route.staticDuration) || durationSeconds;
  const rows = await query<RouteSignalRow>(
    `WITH route AS (
       SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS geometry
     )
     SELECT s.cnn, s.name, s.longitude, s.latitude, s.timing_kind,
            s.cycle_seconds, s.cycle_min_seconds, s.cycle_max_seconds,
            s.confidence, s.vehicle_actuated, s.pedestrian_actuated,
            s.transit_priority,
            ST_Distance(s.geometry::geography, route.geometry::geography) AS distance_meters,
            ST_LineLocatePoint(route.geometry, s.geometry) AS route_position
     FROM public.signal_catalog s, route
     WHERE ST_DWithin(s.geometry::geography, route.geometry::geography, 35)
     ORDER BY route_position ASC`,
    [routeLineGeoJson(encodedPolyline)],
  );

  const signals = rows.map((row) => {
    const cycleSeconds = numberOrNull(row.cycle_seconds);
    const minimum = numberOrNull(row.cycle_min_seconds);
    const maximum = numberOrNull(row.cycle_max_seconds);
    return {
      cnn: row.cnn,
      name: row.name,
      coordinates: [Number(row.longitude), Number(row.latitude)] as [number, number],
      distanceMeters: Number(row.distance_meters),
      timingKind: row.timing_kind ?? "unknown",
      cycleSeconds,
      cycleRangeSeconds: minimum !== null && maximum !== null ? [minimum, maximum] as [number, number] : null,
      confidence: row.confidence ?? "unknown",
      vehicleActuated: row.vehicle_actuated,
      pedestrianActuated: row.pedestrian_actuated,
      transitPriority: row.transit_priority,
    };
  });
  const timingSignals = signals.filter((signal) => signal.timingKind === "current_official" || signal.timingKind === "observed").length;
  const likelySignalStops: [number, number] = [Math.max(0, Math.round(signals.length * 0.25)), Math.max(0, Math.ceil(signals.length * (timingSignals ? 0.7 : 0.9)))];
  const likelySignalDelaySeconds: [number, number] = [likelySignalStops[0] * 15, likelySignalStops[1] * 45];
  return {
    route: { distanceMeters: Number(route.distanceMeters ?? 0), durationSeconds, staticDurationSeconds, delaySeconds: Math.max(0, durationSeconds - staticDurationSeconds), encodedPolyline },
    signals,
    estimate: {
      likelySignalStops,
      likelySignalDelaySeconds,
      confidence: timingSignals > 0 ? "medium" : "low",
      explanation: timingSignals > 0
        ? "Uses traffic-aware routing plus available timing evidence. Vehicle detection, transit priority, and live phase changes can alter the result."
        : "Signal locations are known, but no current timing plans are loaded for this route. This is a conservative location-based estimate.",
    },
    departureTime,
  };
}
