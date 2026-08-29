import { z } from "zod";
import { ApiError } from "@/lib/server/api-error";
import { query } from "@/lib/server/db";
import {
  estimateSignalDelay,
  type Confidence,
  type GreenWindow,
  type RouteSignal,
  type SignalDelayEstimate,
  type SignalTimingEvidence,
  type TimingKind,
  type TimingPlan,
} from "@/lib/server/signal-model";
import {
  generateCandidateDepartureTimes,
  recommendDeparture,
  type DepartureRecommendation,
  type ScoredRouteOutcome,
  type RouteOutcome,
} from "@/lib/server/departure-recommendation";

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

// --- Cost control -----------------------------------------------------------
// Google Routes calls per request are bounded by GLOSSA_MAX_DEPARTURE_CANDIDATES
// (default 3, clamped to 1-5). The planning window is derived from the cap so the
// cap is the exact number of Google calls made (one per candidate). The interval
// is fixed at 15 minutes; with cap N the window spans (N - 1) * 15 minutes, i.e.
// departures at +0, +15, ..., +(N-1)*15 minutes.
const MAX_CANDIDATES_DEFAULT = 3;
const MAX_CANDIDATES_MIN = 1;
const MAX_CANDIDATES_MAX = 5;
const DEPARTURE_INTERVAL_MINUTES = 15;

const SIGNAL_MATCH_RADIUS_METERS = 35;
const GOOGLE_ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
const GOOGLE_FIELD_MASK = "routes.duration,routes.staticDuration,routes.distanceMeters,routes.polyline.encodedPolyline";
const MIN_CYCLE_SECONDS = 20;
const MAX_CYCLE_SECONDS = 300;

function resolveMaxCandidates(): number {
  const raw = Number(process.env.GLOSSA_MAX_DEPARTURE_CANDIDATES ?? MAX_CANDIDATES_DEFAULT);
  const candidate = Number.isFinite(raw) ? Math.trunc(raw) : MAX_CANDIDATES_DEFAULT;
  return Math.min(MAX_CANDIDATES_MAX, Math.max(MAX_CANDIDATES_MIN, candidate));
}

interface GoogleRouteResponse {
  routes?: Array<{
    duration?: string;
    staticDuration?: string;
    distanceMeters?: number;
    polyline?: { encodedPolyline?: string };
  }>;
  error?: { message?: string };
}

interface GoogleRoute {
  distanceMeters: number;
  durationSeconds: number;
  staticDurationSeconds: number;
  delaySeconds: number;
  encodedPolyline: string;
}

/** Stored SFMTA timing-card plan (subset consumed by the route integration). */
interface StoredPhaseInterval {
  phase: number;
  movement?: string;
  greenStartSeconds: number;
  greenEndSeconds: number;
}

interface StoredTimingPlan {
  days?: string[];
  startTime?: string;
  endTime?: string;
  cycleSeconds?: number;
  offsetSeconds?: number;
  phaseIntervals?: StoredPhaseInterval[];
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
  source_as_of: string | Date | null;
  distance_meters: number | string;
  route_position: number | string;
  time_of_day_plans: unknown;
}

export interface RouteEstimateSignal {
  cnn: string;
  name: string;
  coordinates: [number, number];
  distanceMeters: number;
  /** Seconds after departure at which the vehicle reaches this signal. */
  arrivalSeconds: number;
  timingKind: string;
  /** Source observation date of the timing evidence, preserved from signal_catalog. */
  sourceAsOf: string | null;
  cycleSeconds: number | null;
  cycleRangeSeconds: [number, number] | null;
  confidence: string;
  vehicleActuated: boolean | null;
  pedestrianActuated: boolean | null;
  transitPriority: boolean | null;
}

/** One ranked departure option in the recommendation. Names are stable for the UI. */
export interface RankedAlternative {
  departureTime: string;
  scoreSeconds: number;
  scoreRangeSeconds: [number, number];
  trafficDelaySeconds: number;
  signalDelaySeconds: [number, number];
  likelySignalStops: [number, number];
  recommended: boolean;
}

/** Canonical signal-aware departure recommendation. Names are stable for the UI. */
export interface RouteRecommendation {
  recommendedDepartureTime: string;
  scoreSeconds: number;
  scoreRangeSeconds: [number, number];
  trafficDelaySeconds: number;
  signalDelaySeconds: [number, number];
  likelySignalStops: [number, number];
  confidence: Confidence;
  explanation: string;
  rankedAlternatives: RankedAlternative[];
  candidatesConsidered: number;
}

export interface RouteEstimate {
  route: { distanceMeters: number; durationSeconds: number; staticDurationSeconds: number; delaySeconds: number; encodedPolyline: string };
  signals: RouteEstimateSignal[];
  estimate: {
    expectedSignalStops: number;
    likelySignalStops: [number, number];
    expectedSignalDelaySeconds: number;
    likelySignalDelaySeconds: [number, number];
    confidence: Confidence;
    /** Human-readable narrative kept for API/UI consumers. */
    explanation: string;
    /** Structured rationale from the signal delay model. */
    rationale: string;
    modeledSignals: number;
    unknownSignals: number;
  };
  recommendation: RouteRecommendation;
  /** Recommended departure instant. Kept for backwards compatibility with the UI. */
  departureTime: string;
}

interface CandidateEvaluation {
  departureTime: string;
  route: GoogleRoute;
  signals: RouteEstimateSignal[];
  modelEstimate: SignalDelayEstimate;
  outcome: RouteOutcome;
}

const DAY_TO_JS: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};

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

function finiteNonNegative(value: number | string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function sourceDate(value: string | Date | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function clockToMinute(value: string | undefined): number {
  if (!value) return 0;
  if (value === "24:00") return 1440;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

function clampCycle(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.min(MAX_CYCLE_SECONDS, Math.max(MIN_CYCLE_SECONDS, value));
}

/** Select the dominant through-movement green window for the route approach.
 *
 * Without per-approach matching we cannot resolve every phase, so we choose the
 * through movement with the longest green (falling back to the longest green
 * overall). This is a documented heuristic: it lets the model position the
 * vehicle's arrival against a real phase while keeping the conservative cycle
 * fallback when no phase intervals have been transcribed.
 */
function pickGreenWindows(phases: StoredPhaseInterval[] | undefined, cycle: number): GreenWindow[] {
  if (!Array.isArray(phases) || phases.length === 0) return [];
  const valid = phases.filter((phase) =>
    Number.isFinite(phase.greenStartSeconds) && Number.isFinite(phase.greenEndSeconds)
    && phase.greenEndSeconds > phase.greenStartSeconds);
  if (valid.length === 0) return [];
  const through = valid.filter((phase) => /through/i.test(String(phase.movement ?? "")));
  const candidates = through.length > 0 ? through : valid;
  const chosen = candidates.reduce((best, phase) => {
    const duration = phase.greenEndSeconds - phase.greenStartSeconds;
    const bestDuration = best.greenEndSeconds - best.greenStartSeconds;
    return duration > bestDuration ? phase : best;
  });
  return [{
    startSeconds: Math.max(0, Math.min(cycle, Math.round(chosen.greenStartSeconds))),
    endSeconds: Math.max(0, Math.min(cycle, Math.round(chosen.greenEndSeconds))),
  }];
}

/** Convert stored SFMTA timing-card plans into the signal model's plan format. */
function toModelPlans(raw: unknown): TimingPlan[] {
  if (!Array.isArray(raw)) return [];
  const plans: TimingPlan[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const plan = item as StoredTimingPlan;
    const cycleSeconds = clampCycle(plan.cycleSeconds);
    if (!cycleSeconds) continue;
    const startMinute = clockToMinute(plan.startTime);
    const endMinute = plan.endTime ? clockToMinute(plan.endTime) : 1440;
    const daysOfWeek = Array.isArray(plan.days)
      ? plan.days.map((day) => DAY_TO_JS[String(day).toLowerCase()] ?? -1).filter((day) => day >= 0)
      : [];
    plans.push({
      startMinute,
      endMinute: endMinute || 1440,
      daysOfWeek,
      cycleSeconds,
      cycleRangeSeconds: [cycleSeconds, cycleSeconds] as [number, number],
      offsetSeconds: typeof plan.offsetSeconds === "number" && Number.isFinite(plan.offsetSeconds)
        ? Math.max(0, Math.round(plan.offsetSeconds))
        : 0,
      greenWindows: pickGreenWindows(plan.phaseIntervals, cycleSeconds),
    });
  }
  return plans;
}

const ROUTE_SIGNAL_QUERY = `
  WITH route AS (
    SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS geometry
  )
  SELECT s.cnn, s.name, s.longitude, s.latitude, s.timing_kind,
         s.cycle_seconds, s.cycle_min_seconds, s.cycle_max_seconds,
         s.confidence, s.vehicle_actuated, s.pedestrian_actuated,
         s.transit_priority, s.source_as_of, s.time_of_day_plans,
         ST_Distance(s.geometry::geography, route.geometry::geography) AS distance_meters,
         ST_LineLocatePoint(route.geometry, s.geometry) AS route_position
  FROM public.signal_catalog s, route
  WHERE ST_DWithin(s.geometry::geography, route.geometry::geography, ${SIGNAL_MATCH_RADIUS_METERS})
  ORDER BY route_position ASC`;

async function fetchGoogleRoute(input: z.infer<typeof routeEstimateRequestSchema>, departureTime: string, apiKey: string): Promise<GoogleRoute> {
  const response = await fetch(GOOGLE_ROUTES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": GOOGLE_FIELD_MASK,
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
  if (!response.ok || !body.routes?.[0]) {
    throw new ApiError(502, "route_unavailable", body.error?.message ?? "Google could not calculate this route.");
  }
  const route = body.routes[0];
  const encodedPolyline = route.polyline?.encodedPolyline;
  if (!encodedPolyline) throw new ApiError(502, "route_unavailable", "Google returned no route geometry.");
  const durationSeconds = parseDuration(route.duration);
  const staticDurationSeconds = parseDuration(route.staticDuration) || durationSeconds;
  return {
    distanceMeters: Number(route.distanceMeters ?? 0),
    durationSeconds,
    staticDurationSeconds,
    delaySeconds: Math.max(0, durationSeconds - staticDurationSeconds),
    encodedPolyline,
  };
}

async function evaluateCandidate(
  input: z.infer<typeof routeEstimateRequestSchema>,
  departureTime: string,
  apiKey: string,
): Promise<CandidateEvaluation> {
  const route = await fetchGoogleRoute(input, departureTime, apiKey);
  const routeGeoJson = routeLineGeoJson(route.encodedPolyline);
  const rows = await query<RouteSignalRow>(ROUTE_SIGNAL_QUERY, [routeGeoJson]);

  const modelSignals: RouteSignal[] = [];
  const signalOutput: RouteEstimateSignal[] = [];
  for (const row of rows) {
    const routePosition = Math.min(1, Math.max(0, finiteNonNegative(row.route_position)));
    const arrivalSeconds = Math.max(0, Math.round(routePosition * route.durationSeconds));
    const cycleSeconds = numberOrNull(row.cycle_seconds);
    const minimum = numberOrNull(row.cycle_min_seconds);
    const maximum = numberOrNull(row.cycle_max_seconds);
    const cycleRangeSeconds = minimum !== null && maximum !== null ? [minimum, maximum] as [number, number] : null;
    const timingKind = (row.timing_kind ?? "unknown") as TimingKind;
    const modelPlans = toModelPlans(row.time_of_day_plans);

    const timingEvidence: SignalTimingEvidence | undefined = modelPlans.length > 0
      ? {
          timingKind,
          cycleSeconds,
          cycleRangeSeconds: cycleRangeSeconds ?? (cycleSeconds ? [cycleSeconds, cycleSeconds] as [number, number] : null),
          vehicleActuated: row.vehicle_actuated,
          pedestrianActuated: row.pedestrian_actuated,
          transitPriority: row.transit_priority,
          timeOfDayPlans: modelPlans,
        }
      : undefined;

    modelSignals.push({
      cnn: row.cnn,
      name: row.name,
      distanceMeters: finiteNonNegative(row.distance_meters),
      arrivalSeconds,
      timingKind,
      cycleSeconds,
      cycleRangeSeconds: cycleRangeSeconds,
      vehicleActuated: row.vehicle_actuated,
      pedestrianActuated: row.pedestrian_actuated,
      transitPriority: row.transit_priority,
      ...(timingEvidence ? { timing: timingEvidence } : {}),
    });

    signalOutput.push({
      cnn: row.cnn,
      name: row.name,
      coordinates: [Number(row.longitude), Number(row.latitude)] as [number, number],
      distanceMeters: finiteNonNegative(row.distance_meters),
      arrivalSeconds,
      timingKind: row.timing_kind ?? "unknown",
      sourceAsOf: sourceDate(row.source_as_of),
      cycleSeconds,
      cycleRangeSeconds: cycleRangeSeconds,
      confidence: row.confidence ?? "unknown",
      vehicleActuated: row.vehicle_actuated,
      pedestrianActuated: row.pedestrian_actuated,
      transitPriority: row.transit_priority,
    });
  }

  const modelEstimate = estimateSignalDelay({
    signals: modelSignals,
    departureTime,
    arrivalSeconds: modelSignals.map((signal) => signal.arrivalSeconds ?? 0),
  });

  const outcome: RouteOutcome = {
    departureTime,
    trafficDelaySeconds: route.delaySeconds,
    modeledSignalDelaySeconds: [modelEstimate.likelySignalDelaySeconds[0], modelEstimate.likelySignalDelaySeconds[1]] as [number, number],
    likelySignalStops: [modelEstimate.likelySignalStops[0], modelEstimate.likelySignalStops[1]] as [number, number],
  };

  return { departureTime, route, signals: signalOutput, modelEstimate, outcome };
}

/** Honesty floor: any stale or unknown evidence caps confidence at "low".
 *
 * The signal model (Agent 3) reports "medium" for stale-only cycles. To honor the
 * honesty requirement that stale/unknown evidence never reads above low, the
 * integration layer downgrades to "low" whenever any matched signal carries stale
 * or unknown timing. Modeled evidence is already "low" in the model; current or
 * observed evidence keeps the model's ("high"/"medium"). This is an integration
 * policy only; the model's own estimate is left untouched.
 */
function honestyFloorConfidence(modelEstimate: SignalDelayEstimate, signals: RouteEstimateSignal[]): Confidence {
  const hasStaleOrUnknown = signals.some(
    (signal) => signal.timingKind === "stale_official" || signal.timingKind === "unknown",
  );
  if (hasStaleOrUnknown) return "low";
  return modelEstimate.confidence;
}

function toRankedAlternative(
  scored: ScoredRouteOutcome,
  recommendedTime: string,
): RankedAlternative {
  const likelyStops = scored.likelySignalStops
    ? [scored.likelySignalStops[0], scored.likelySignalStops[1]] as [number, number]
    : [0, 0] as [number, number];
  return {
    departureTime: scored.departureTime,
    scoreSeconds: Math.round(scored.scoreSeconds),
    scoreRangeSeconds: [Math.round(scored.scoreRangeSeconds[0]), Math.round(scored.scoreRangeSeconds[1])] as [number, number],
    trafficDelaySeconds: scored.trafficDelaySeconds,
    signalDelaySeconds: [scored.modeledSignalDelaySeconds[0], scored.modeledSignalDelaySeconds[1]] as [number, number],
    likelySignalStops: likelyStops,
    recommended: scored.departureTime === recommendedTime,
  };
}

function buildRankedAlternatives(
  recommendation: DepartureRecommendation,
  recommendedTime: string,
): RankedAlternative[] {
  return recommendation.scoredOutcomes
    .map((scored) => toRankedAlternative(scored, recommendedTime))
    .sort((a, b) => a.scoreSeconds - b.scoreSeconds || a.departureTime.localeCompare(b.departureTime));
}

function buildExplanation(
  modelEstimate: SignalDelayEstimate,
  recommendation: DepartureRecommendation,
  consideredCount: number,
  confidence: Confidence,
): string {
  const recommended = recommendation.recommendation;
  const bestSeconds = recommended ? Math.round(recommended.scoreSeconds) : 0;
  const honesty = confidence === "low"
    ? " Signal-timing evidence is stale or unavailable, so this is a conservative location-based estimate, not a live phase read."
    : "";
  return [
    modelEstimate.rationale,
    `Compared ${consideredCount} departure time${consideredCount === 1 ? "" : "s"} and selected the lowest expected delay of about ${bestSeconds} seconds.`,
    recommendation.uncertaintyExplanation,
    honesty,
  ].filter(Boolean).join(" ");
}

export async function estimateRoute(input: z.infer<typeof routeEstimateRequestSchema>): Promise<RouteEstimate> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey || apiKey.includes("replace_me")) {
    throw new ApiError(503, "route_unavailable", "Google Maps routing is not configured.");
  }

  const maxCandidates = resolveMaxCandidates();
  // Window spans (maxCandidates - 1) intervals so exactly maxCandidates departures
  // are generated (and exactly that many Google calls are made).
  const windowMinutes = Math.max(0, (maxCandidates - 1) * DEPARTURE_INTERVAL_MINUTES);

  const now = new Date();
  // Google requires an explicitly supplied departure time to be in the future;
  // one minute of slack keeps "leave now" valid without racing the API.
  const earliestStart = new Date(now.getTime() + 60_000);
  const requested = input.departureTime ? new Date(input.departureTime) : null;
  const windowStart = requested && Number.isFinite(requested.getTime()) && requested > earliestStart
    ? requested
    : earliestStart;

  const candidateOptions = {
    now,
    window: { start: windowStart, durationMinutes: windowMinutes },
    intervalMinutes: DEPARTURE_INTERVAL_MINUTES,
  };
  const candidates = generateCandidateDepartureTimes(candidateOptions);

  // Evaluate candidates in order. The first candidate is the "primary" (nearest
  // the requested departure); if it fails the whole request fails. A failed
  // non-primary candidate is skipped so a single bad future slot never blocks the
  // recommendation.
  const evaluations: CandidateEvaluation[] = [];
  for (let index = 0; index < candidates.length; index++) {
    const departureTime = candidates[index];
    const isPrimary = index === 0;
    try {
      evaluations.push(await evaluateCandidate(input, departureTime, apiKey));
    } catch (error) {
      if (isPrimary) throw error;
      console.warn("route-estimate: skipped non-primary departure candidate", {
        departureTime,
        cause: error instanceof Error ? error.message : "unknown error",
      });
    }
  }
  if (evaluations.length === 0) {
    throw new ApiError(502, "route_unavailable", "Google could not calculate this route.");
  }

  const outcomes = evaluations.map((evaluation) => evaluation.outcome);
  const recommendation = recommendDeparture({ ...candidateOptions, outcomes });
  const recommended = recommendation.recommendation;
  if (!recommended) {
    throw new ApiError(502, "route_unavailable", "Google could not calculate this route.");
  }

  const chosen = evaluations.find((evaluation) => evaluation.departureTime === recommended.departureTime) ?? evaluations[0];
  const confidence = honestyFloorConfidence(chosen.modelEstimate, chosen.signals);
  const rankedAlternatives = buildRankedAlternatives(recommendation, recommended.departureTime);
  const explanation = buildExplanation(chosen.modelEstimate, recommendation, evaluations.length, confidence);

  return {
    route: {
      distanceMeters: chosen.route.distanceMeters,
      durationSeconds: chosen.route.durationSeconds,
      staticDurationSeconds: chosen.route.staticDurationSeconds,
      delaySeconds: chosen.route.delaySeconds,
      encodedPolyline: chosen.route.encodedPolyline,
    },
    signals: chosen.signals,
    estimate: {
      expectedSignalStops: chosen.modelEstimate.expectedStops,
      likelySignalStops: chosen.modelEstimate.likelySignalStops,
      expectedSignalDelaySeconds: chosen.modelEstimate.expectedDelaySeconds,
      likelySignalDelaySeconds: chosen.modelEstimate.likelySignalDelaySeconds,
      confidence,
      explanation,
      rationale: chosen.modelEstimate.rationale,
      modeledSignals: chosen.modelEstimate.modeledSignals,
      unknownSignals: chosen.modelEstimate.unknownSignals,
    },
    recommendation: {
      recommendedDepartureTime: recommended.departureTime,
      scoreSeconds: Math.round(recommended.scoreSeconds),
      scoreRangeSeconds: [Math.round(recommended.scoreRangeSeconds[0]), Math.round(recommended.scoreRangeSeconds[1])] as [number, number],
      trafficDelaySeconds: recommended.trafficDelaySeconds,
      signalDelaySeconds: [recommended.modeledSignalDelaySeconds[0], recommended.modeledSignalDelaySeconds[1]] as [number, number],
      likelySignalStops: (recommended.likelySignalStops
        ? [recommended.likelySignalStops[0], recommended.likelySignalStops[1]]
        : [0, 0]) as [number, number],
      confidence,
      explanation,
      rankedAlternatives,
      candidatesConsidered: evaluations.length,
    },
    departureTime: recommended.departureTime,
  };
}
