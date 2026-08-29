/**
 * Deterministic, database- and network-free signal delay model.
 *
 * `greenWindows` are seconds from the start of a cycle during which the
 * requested route movement may proceed. They should be extracted from a
 * timing card for the route's approach/movement; a cycle alone is not enough
 * to identify the actual signal phase.
 */

export type TimingKind =
  | "current_official"
  | "stale_official"
  | "observed"
  | "modeled"
  | "unknown";

export type Confidence = "low" | "medium" | "high";

export interface GreenWindow {
  startSeconds: number;
  endSeconds: number;
}

export interface TimingPlan {
  /** Local minutes after midnight. End may be less than start for overnight plans. */
  startMinute: number;
  endMinute: number;
  /** JavaScript day numbers: Sunday = 0 through Saturday = 6. */
  daysOfWeek?: number[];
  cycleSeconds?: number;
  cycleRangeSeconds?: [number, number];
  offsetSeconds?: number;
  greenWindows?: GreenWindow[];
}

export interface SignalTimingEvidence {
  timingKind?: TimingKind;
  cycleSeconds?: number | null;
  cycleRangeSeconds?: [number, number] | null;
  offsetSeconds?: number | null;
  greenWindows?: GreenWindow[];
  timeOfDayPlans?: TimingPlan[];
  vehicleActuated?: boolean | null;
  pedestrianActuated?: boolean | null;
  transitPriority?: boolean | null;
  rationale?: string;
}

export interface RouteSignal {
  cnn?: string;
  name?: string;
  /** Distance from route origin. Used with routeSpeedMps when arrivalSeconds is absent. */
  distanceMeters?: number;
  /** Seconds after departure at which the vehicle reaches this signal. */
  arrivalSeconds?: number;
  timing?: SignalTimingEvidence;
  // Flat fields are accepted to make this usable with route-estimate output.
  timingKind?: TimingKind;
  cycleSeconds?: number | null;
  cycleRangeSeconds?: [number, number] | null;
  vehicleActuated?: boolean | null;
  pedestrianActuated?: boolean | null;
  transitPriority?: boolean | null;
}

export interface SignalDelayModelInput {
  signals: RouteSignal[];
  departureTime?: Date | string;
  routeSpeedMps?: number;
  /** Optional deterministic travel time to each signal, keyed by array index. */
  arrivalSeconds?: number[];
}

export interface SignalDelayEstimate {
  expectedStops: number;
  likelySignalStops: [number, number];
  expectedDelaySeconds: number;
  likelySignalDelaySeconds: [number, number];
  confidence: Confidence;
  rationale: string;
  modeledSignals: number;
  unknownSignals: number;
}

const DEFAULT_SPEED_MPS = 11.176; // 25 mph: deliberately conservative urban approach speed.
const MIN_CYCLE_SECONDS = 20;
const MAX_CYCLE_SECONDS = 300;

function finitePositive(value: number | null | undefined): number | null {
  return value !== null && value !== undefined && Number.isFinite(value) && value > 0 ? value : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeCycle(value: number | null | undefined): number | null {
  const cycle = finitePositive(value);
  return cycle === null ? null : clamp(cycle, MIN_CYCLE_SECONDS, MAX_CYCLE_SECONDS);
}

function normalizeWindows(windows: GreenWindow[] | undefined, cycle: number): GreenWindow[] {
  if (!windows?.length) return [];
  return windows
    .filter((window) => Number.isFinite(window.startSeconds) && Number.isFinite(window.endSeconds))
    .map((window) => ({
      startSeconds: clamp(window.startSeconds, 0, cycle),
      endSeconds: clamp(window.endSeconds, 0, cycle),
    }))
    .filter((window) => window.endSeconds > window.startSeconds);
}

function localMinuteAndDay(value: Date | string | undefined): { minute: number; day: number } | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return { minute: date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60, day: date.getDay() };
}

function inPlanWindow(minute: number, plan: TimingPlan): boolean {
  return plan.startMinute <= plan.endMinute
    ? minute >= plan.startMinute && minute < plan.endMinute
    : minute >= plan.startMinute || minute < plan.endMinute;
}

function selectPlan(evidence: SignalTimingEvidence, departureTime: Date | string | undefined): TimingPlan | null {
  const local = localMinuteAndDay(departureTime);
  if (!local || !evidence.timeOfDayPlans?.length) return null;
  return evidence.timeOfDayPlans.find((plan) =>
    (!plan.daysOfWeek || plan.daysOfWeek.includes(local.day)) && inPlanWindow(local.minute, plan),
  ) ?? null;
}

function effectiveEvidence(signal: RouteSignal, departureTime: Date | string | undefined): SignalTimingEvidence {
  const flat: SignalTimingEvidence = {
    timingKind: signal.timingKind,
    cycleSeconds: signal.cycleSeconds,
    cycleRangeSeconds: signal.cycleRangeSeconds,
    vehicleActuated: signal.vehicleActuated,
    pedestrianActuated: signal.pedestrianActuated,
    transitPriority: signal.transitPriority,
  };
  const evidence = signal.timing ?? flat;
  const plan = selectPlan(evidence, departureTime);
  return plan ? { ...evidence, ...plan } : evidence;
}

function arrivalFor(signal: RouteSignal, index: number, input: SignalDelayModelInput): number {
  const explicit = input.arrivalSeconds?.[index] ?? signal.arrivalSeconds;
  if (explicit !== undefined && Number.isFinite(explicit)) return Math.max(0, explicit);
  return Math.max(0, (signal.distanceMeters ?? index * 100) / (input.routeSpeedMps ?? DEFAULT_SPEED_MPS));
}

function phaseAt(arrivalSeconds: number, cycle: number, offset: number): number {
  return ((arrivalSeconds - offset) % cycle + cycle) % cycle;
}

function isGreen(phase: number, windows: GreenWindow[]): boolean {
  return windows.some((window) => phase >= window.startSeconds && phase < window.endSeconds);
}

export function estimateSignalDelay(input: SignalDelayModelInput): SignalDelayEstimate {
  if (input.signals.length === 0) {
    return {
      expectedStops: 0,
      likelySignalStops: [0, 0],
      expectedDelaySeconds: 0,
      likelySignalDelaySeconds: [0, 0],
      confidence: "high",
      rationale: "No signalized intersections were supplied for this route.",
      modeledSignals: 0,
      unknownSignals: 0,
    };
  }

  let expectedStops = 0;
  let expectedDelay = 0;
  let lowerStops = 0;
  let upperStops = 0;
  let lowerDelay = 0;
  let upperDelay = 0;
  let modeledSignals = 0;
  let unknownSignals = 0;
  let weakestConfidence = 2;

  for (const [index, signal] of input.signals.entries()) {
    const evidence = effectiveEvidence(signal, input.departureTime);
    const kind = evidence.timingKind ?? "unknown";
    const cycle = normalizeCycle(evidence.cycleSeconds)
      ?? (evidence.cycleRangeSeconds ? normalizeCycle(evidence.cycleRangeSeconds[0]) : null);
    const range = evidence.cycleRangeSeconds && cycle
      ? [normalizeCycle(evidence.cycleRangeSeconds[0]) ?? cycle, normalizeCycle(evidence.cycleRangeSeconds[1]) ?? cycle] as [number, number]
      : cycle ? [cycle, cycle] as [number, number] : null;

    if (!cycle || kind === "unknown") {
      unknownSignals += 1;
      expectedStops += 0.5;
      expectedDelay += 22.5;
      upperStops += 1;
      upperDelay += 60;
      weakestConfidence = Math.min(weakestConfidence, 0);
      continue;
    }

    modeledSignals += 1;
    const offset = Number.isFinite(evidence.offsetSeconds) ? evidence.offsetSeconds! : 0;
    const windows = normalizeWindows(evidence.greenWindows, cycle);
    const arrival = arrivalFor(signal, index, input);
    const stopped = windows.length > 0 ? !isGreen(phaseAt(arrival, cycle, offset), windows) : true;
    const greenRatio = windows.length > 0
      ? clamp(windows.reduce((sum, window) => sum + window.endSeconds - window.startSeconds, 0) / cycle, 0.05, 0.95)
      : 0.5;
    const actuated = evidence.vehicleActuated === true || evidence.pedestrianActuated === true;
    const specialOperation = evidence.transitPriority === true;
    const uncertainty = actuated || specialOperation || kind === "stale_official" ? 0.25 : 0;
    const baseDelay = stopped ? Math.max(0, cycle - phaseAt(arrival, cycle, offset)) : 0;
    const expectedAtSignal = windows.length > 0 ? (stopped ? baseDelay : 0) : cycle * (1 - greenRatio) / 2;

    expectedStops += windows.length > 0 ? (stopped ? 1 : 0) : 1 - greenRatio;
    expectedDelay += expectedAtSignal;
    lowerStops += windows.length > 0 ? (stopped ? Math.max(0, 1 - uncertainty) : 0) : Math.max(0, (1 - greenRatio) - uncertainty);
    upperStops += windows.length > 0 ? (stopped ? 1 : uncertainty) : Math.min(1, (1 - greenRatio) + uncertainty);
    lowerDelay += Math.max(0, expectedAtSignal * (1 - uncertainty));
    upperDelay += Math.min((range?.[1] ?? cycle), expectedAtSignal * (1 + uncertainty) + (actuated ? 10 : 0));
    weakestConfidence = Math.min(weakestConfidence, kind === "current_official" || kind === "observed" ? 2 : kind === "stale_official" ? 1 : 0);
  }

  const confidence: Confidence = weakestConfidence >= 2 && unknownSignals === 0 ? "high" : weakestConfidence >= 1 && unknownSignals === 0 ? "medium" : "low";
  const rationaleParts = [
    "Evaluates each signal against its supplied cycle, offset, and route arrival time.",
    modeledSignals ? `${modeledSignals} signal${modeledSignals === 1 ? "" : "s"} had timing evidence.` : "No usable timing evidence was supplied.",
  ];
  if (unknownSignals) rationaleParts.push(`${unknownSignals} signal${unknownSignals === 1 ? "" : "s"} remain unknown; their ranges are conservative.`);
  if (input.signals.some((signal) => signal.timing?.vehicleActuated || signal.vehicleActuated || signal.timing?.pedestrianActuated || signal.pedestrianActuated)) rationaleParts.push("Actuation can extend or defer phases beyond the base plan.");
  if (input.signals.some((signal) => signal.timing?.transitPriority || signal.transitPriority)) rationaleParts.push("Transit priority may change the published progression.");

  return {
    expectedStops: Number(expectedStops.toFixed(2)),
    likelySignalStops: [Math.floor(lowerStops), Math.ceil(upperStops)],
    expectedDelaySeconds: Number(expectedDelay.toFixed(1)),
    likelySignalDelaySeconds: [Math.floor(lowerDelay), Math.ceil(upperDelay)],
    confidence,
    rationale: rationaleParts.join(" "),
    modeledSignals,
    unknownSignals,
  };
}
