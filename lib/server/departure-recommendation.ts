/** Pure departure-time optimization for route estimates.
 *
 * This module deliberately has no clock, network, database, or framework
 * dependencies. Callers may pass a fixed `now` so recommendations are
 * reproducible in tests and demos. It combines Google's traffic-aware delay
 * with a modeled signal delay (and its uncertainty range) and selects the
 * candidate with the lowest expected total delay.
 */

export type DateLike = string | Date;
export type SecondsRange = readonly [number, number];
export type Confidence = "low" | "medium" | "high";

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
  /** Minutes between candidates. Defaults to 15. */
  intervalMinutes?: number;
  /** When true, include the exact window start even if it is off the interval. Defaults to true. */
  includeStart?: boolean;
}

/** A single departure candidate's delay inputs.
 *
 * Traffic delay is the Google-modeled delay (duration minus free-flow). The
 * modeled signal delay and likely stops carry uncertainty ranges from the
 * signal model; the optimizer preserves those ranges in its output.
 */
export interface RouteOutcome {
  departureTime: DateLike;
  trafficDelaySeconds: number;
  modeledSignalDelaySeconds: number | SecondsRange;
  likelySignalStops?: number | SecondsRange;
  /** Authoritative confidence for the modeled signal portion (e.g. from the
   * signal model or route estimate). When omitted the confidence is derived
   * from the width of the modeled delay range. */
  confidence?: Confidence;
}

/** A scored, UTC-normalized, deterministic view of a single candidate. */
export interface ScoredRouteOutcome {
  /** Timezone-safe UTC ISO timestamp of the candidate departure. */
  departureTime: string;
  trafficDelaySeconds: number;
  modeledSignalDelaySeconds: SecondsRange;
  likelySignalStops: SecondsRange | null;
  /** Expected (mean) number of signal stops, or null when none were supplied. */
  expectedSignalStops: number | null;
  /** Expected total delay in seconds (traffic + mean modeled signal). Lower is better. */
  scoreSeconds: number;
  /** Preserved uncertainty range for the total delay. */
  scoreRangeSeconds: SecondsRange;
  /** Confidence in the modeled signal portion of the score. */
  confidence: Confidence;
  /** Deterministic, human-readable explanation of this candidate's score. */
  explanation: string;
}

export interface DepartureRecommendationOptions extends CandidateDepartureOptions {
  outcomes: readonly RouteOutcome[];
}

export interface DepartureRecommendation {
  candidates: string[];
  scoredOutcomes: ScoredRouteOutcome[];
  /** Best candidate, or null when no outcomes matched the generated candidates. */
  recommendation: ScoredRouteOutcome | null;
  /** Comparison-level explanation for the chosen (or missing) recommendation. */
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

function asRange(value: number | SecondsRange, label: string): SecondsRange {
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

function meanOf(range: SecondsRange): number {
  return Number(((range[0] + range[1]) / 2).toFixed(2));
}

/** Derive confidence from how wide the modeled signal range is relative to the
 * expected total delay. A narrow range relative to the total reads as "high";
 * a range about as wide as the total reads as "low". */
function deriveConfidence(signal: SecondsRange, traffic: number): Confidence {
  const signalWidth = signal[1] - signal[0];
  const expectedTotal = traffic + (signal[0] + signal[1]) / 2;
  if (expectedTotal <= 0) return "high";
  const relativeUncertainty = signalWidth / 2 / expectedTotal;
  if (relativeUncertainty < 0.15) return "high";
  if (relativeUncertainty < 0.35) return "medium";
  return "low";
}

function roundSeconds(value: number): number {
  return Math.round(value);
}

function explainOutcome(scored: ScoredRouteOutcome): string {
  const signal = `${roundSeconds(scored.modeledSignalDelaySeconds[0])}-${roundSeconds(scored.modeledSignalDelaySeconds[1])}s`;
  const total = `${roundSeconds(scored.scoreRangeSeconds[0])}-${roundSeconds(scored.scoreRangeSeconds[1])}s`;
  const stops = scored.likelySignalStops
    ? ` Expected ${scored.expectedSignalStops} signal stops (range ${scored.likelySignalStops[0]}-${scored.likelySignalStops[1]}).`
    : "";
  return [
    `Departing at ${scored.departureTime} expects ~${roundSeconds(scored.scoreSeconds)}s of delay`,
    `(traffic ${roundSeconds(scored.trafficDelaySeconds)}s + modeled signal ${signal})`,
    `with a total delay range of ${total} at ${scored.confidence} confidence.`,
  ].join(" ") + stops;
}

function explainRecommendation(recommendation: ScoredRouteOutcome | null): string {
  if (!recommendation) return "No route outcomes were supplied for the generated departure candidates.";
  return [
    `Best departure is ${recommendation.departureTime}: expect ~${roundSeconds(recommendation.scoreSeconds)}s of delay`,
    `(range ${roundSeconds(recommendation.scoreRangeSeconds[0])}-${roundSeconds(recommendation.scoreRangeSeconds[1])}s,`,
    `${recommendation.confidence} confidence).`,
    "Traffic and signal behavior can vary with detection, transit priority, and live timing changes.",
  ].join(" ");
}

/** Generate inclusive, UTC-normalized candidate instants at a fixed interval.
 *
 * With the defaults this yields `now`, `+15`, `+30`, `+45`, and `+60` minutes. */
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
  const signal = asRange(outcome.modeledSignalDelaySeconds, "modeledSignalDelaySeconds");
  const stops = outcome.likelySignalStops === undefined ? null : asRange(outcome.likelySignalStops, "likelySignalStops");
  const confidence = outcome.confidence ?? deriveConfidence(signal, traffic);
  const scored: ScoredRouteOutcome = {
    departureTime,
    trafficDelaySeconds: traffic,
    modeledSignalDelaySeconds: signal,
    likelySignalStops: stops,
    expectedSignalStops: stops ? meanOf(stops) : null,
    // The optimization objective is expected traffic delay plus expected signal delay.
    scoreSeconds: traffic + (signal[0] + signal[1]) / 2,
    scoreRangeSeconds: [traffic + signal[0], traffic + signal[1]],
    confidence,
    explanation: "",
  };
  scored.explanation = explainOutcome(scored);
  return scored;
}

/** Score supplied route results and choose the lowest expected delay.
 *
 * `scoredOutcomes` is returned as a ranked list: best (lowest expected delay)
 * first, then the remaining alternatives in ascending score order. Ties on
 * the score are broken deterministically by the earliest departure time
 * (lexicographic UTC ISO comparison), independent of the input order. The
 * `recommendation` is the first element of that ranked list (or null when no
 * outcomes matched the generated candidates). */
export function recommendDeparture(options: DepartureRecommendationOptions): DepartureRecommendation {
  const candidates = generateCandidateDepartureTimes(options);
  const byTime = new Map(options.outcomes.map((outcome) => [iso(outcome.departureTime, "departureTime"), scoreRouteOutcome(outcome)]));
  const matched = candidates.flatMap((candidate) => {
    const outcome = byTime.get(candidate);
    return outcome ? [outcome] : [];
  });
  // Rank best-first: ascending scoreSeconds, tie-break by earliest departure.
  const scoredOutcomes = [...matched].sort((a, b) =>
    a.scoreSeconds - b.scoreSeconds || (a.departureTime < b.departureTime ? -1 : a.departureTime > b.departureTime ? 1 : 0),
  );
  const recommendation = scoredOutcomes[0] ?? null;
  return {
    candidates,
    scoredOutcomes,
    recommendation,
    uncertaintyExplanation: explainRecommendation(recommendation),
  };
}
