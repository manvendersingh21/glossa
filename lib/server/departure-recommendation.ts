/** Pure departure-time optimization for route estimates.
 *
 * This module deliberately has no clock, network, database, or framework
 * dependencies. Callers may pass a fixed `now` so recommendations are
 * reproducible in tests and demos.
 */

export type DateLike = string | Date;
export type SecondsRange = readonly [number, number];

export interface DepartureWindow {
  /** Inclusive start. Defaults to `now` (or the current instant). */
  start?: DateLike;
  /** Inclusive end. Defaults to `start + durationMinutes`. */
  end?: DateLike;
  /** Convenience alternative to `end`; defaults to 60 minutes. */
  durationMinutes?: number;
}

export interface CandidateDepartureOptions {
  now?: DateLike;
  window?: DepartureWindow;
  intervalMinutes?: number;
  /** When true, include the exact window start even if it is off the interval. */
  includeStart?: boolean;
}

export interface RouteOutcome {
  departureTime: DateLike;
  trafficDelaySeconds: number;
  modeledSignalDelaySeconds: number | SecondsRange;
  likelySignalStops?: number | SecondsRange;
}

export interface ScoredRouteOutcome {
  departureTime: string;
  trafficDelaySeconds: number;
  modeledSignalDelaySeconds: SecondsRange;
  likelySignalStops: SecondsRange | null;
  scoreSeconds: number;
  scoreRangeSeconds: SecondsRange;
}

export interface DepartureRecommendationOptions extends CandidateDepartureOptions {
  outcomes: readonly RouteOutcome[];
}

export interface DepartureRecommendation {
  candidates: string[];
  scoredOutcomes: ScoredRouteOutcome[];
  recommendation: ScoredRouteOutcome | null;
  uncertaintyExplanation: string;
}

function asDate(value: DateLike, label: string): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new RangeError(`${label} must be a valid ISO timestamp.`);
  return date;
}

function iso(value: DateLike, label: string): string {
  return asDate(value, label).toISOString();
}

function nonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be a finite non-negative number.`);
  return value;
}

function range(value: number | SecondsRange, label: string): SecondsRange {
  if (typeof value === "number") {
    const seconds = nonNegative(value, label);
    return [seconds, seconds];
  }
  if (value.length !== 2) throw new RangeError(`${label} must contain two values.`);
  const minimum = nonNegative(value[0], `${label} minimum`);
  const maximum = nonNegative(value[1], `${label} maximum`);
  if (minimum > maximum) throw new RangeError(`${label} minimum cannot exceed maximum.`);
  return [minimum, maximum];
}

/** Generate inclusive, UTC-normalized candidate instants at a fixed interval. */
export function generateCandidateDepartureTimes(options: CandidateDepartureOptions = {}): string[] {
  const now = asDate(options.now ?? new Date(), "now");
  const start = asDate(options.window?.start ?? now, "window start");
  const end = options.window?.end
    ? asDate(options.window.end, "window end")
    : new Date(start.getTime() + (options.window?.durationMinutes ?? 60) * 60_000);
  const intervalMinutes = options.intervalMinutes ?? 15;
  if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) throw new RangeError("intervalMinutes must be positive.");
  if (end < start) throw new RangeError("window end must be after window start.");
  if (start < now) throw new RangeError("window start cannot be before now.");
  const interval = intervalMinutes * 60_000;
  const candidates: string[] = [];
  if (options.includeStart !== false) candidates.push(start.toISOString());
  for (let time = start.getTime() + interval; time <= end.getTime(); time += interval) {
    candidates.push(new Date(time).toISOString());
  }
  return candidates;
}

export function scoreRouteOutcome(outcome: RouteOutcome): ScoredRouteOutcome {
  const departureTime = iso(outcome.departureTime, "departureTime");
  const traffic = nonNegative(outcome.trafficDelaySeconds, "trafficDelaySeconds");
  const signal = range(outcome.modeledSignalDelaySeconds, "modeledSignalDelaySeconds");
  const stops = outcome.likelySignalStops === undefined ? null : range(outcome.likelySignalStops, "likelySignalStops");
  return {
    departureTime,
    trafficDelaySeconds: traffic,
    modeledSignalDelaySeconds: signal,
    likelySignalStops: stops,
    // The optimization objective is expected traffic delay plus expected signal delay.
    scoreSeconds: traffic + (signal[0] + signal[1]) / 2,
    scoreRangeSeconds: [traffic + signal[0], traffic + signal[1]],
  };
}

/** Score supplied route results and choose the lowest expected delay. */
export function recommendDeparture(options: DepartureRecommendationOptions): DepartureRecommendation {
  const candidates = generateCandidateDepartureTimes(options);
  const byTime = new Map(options.outcomes.map((outcome) => [iso(outcome.departureTime, "departureTime"), scoreRouteOutcome(outcome)]));
  const scoredOutcomes = candidates.flatMap((candidate) => {
    const outcome = byTime.get(candidate);
    return outcome ? [outcome] : [];
  });
  const recommendation = scoredOutcomes.reduce<ScoredRouteOutcome | null>((best, current) => {
    if (!best || current.scoreSeconds < best.scoreSeconds ||
      (current.scoreSeconds === best.scoreSeconds && current.departureTime < best.departureTime)) return current;
    return best;
  }, null);
  const uncertaintyExplanation = recommendation
    ? `Expected delay is ${Math.round(recommendation.scoreSeconds)} seconds; modeled bounds are ${Math.round(recommendation.scoreRangeSeconds[0])}-${Math.round(recommendation.scoreRangeSeconds[1])} seconds. Traffic and signal behavior can vary with detection, transit priority, and live timing changes.`
    : "No route outcomes were supplied for the generated departure candidates.";
  return { candidates, scoredOutcomes, recommendation, uncertaintyExplanation };
}
