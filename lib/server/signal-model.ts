/**
 * Deterministic signal delay model.
 *
 * Given route-arrival times and SFMTA-style timing plans, this module estimates
 * how many signals a vehicle will stop at and how long it will wait. The model is
 * deterministic and pure: it uses only the evidence supplied in the input, it
 * calls no Google, PostgreSQL, or other external service, and it never reads
 * the wall clock, so every result is reproducible from the inputs alone. It does
 * NOT represent live controller state — phase, red/yellow/green, actuation
 * calls, transit priority, and preemption are not published live by SFMTA; this
 * is an estimate under the published plan, not a traffic-control feed.
 *
 * Methodology (see docs/SFMTA_TIMING_RESEARCH.md and docs/METHODOLOGY.md):
 *  1. Select the applicable time-of-day plan by weekday and time window.
 *  2. Apply that plan's cycle, offset, and the route movement's green windows.
 *  3. Place the vehicle on the route (explicit arrival seconds, or distance /
 *     speed) and evaluate its arrival phase against the green windows.
 *  4. Widen the estimate for actuation, transit priority, emergency preemption,
 *     stale evidence, and plans that do not cover the departure time.
 *
 * `greenWindows` are seconds from the start of a cycle during which the
 * requested route movement may proceed. They must be extracted from a timing
 * card for the route's approach/movement; a cycle alone is not enough to
 * identify the actual signal phase, so a cycle-only signal is modeled
 * probabilistically rather than as a deterministic stop.
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
  emergencyPreemption?: boolean | null;
  /**
   * ISO date after which current_official evidence is treated as stale,
   * evaluated against the route's departure time (not the wall clock).
   */
  staleAfter?: string | null;
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
  emergencyPreemption?: boolean | null;
  staleAfter?: string | null;
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

// Conservative fallbacks for a signal with no usable timing evidence.
const UNKNOWN_STOP_EXPECTED = 0.5;
const UNKNOWN_DELAY_EXPECTED = 22.5;
const UNKNOWN_STOP_UPPER = 1;
const UNKNOWN_DELAY_UPPER = 60;

// Scenario-modifier bands. Per docs/SFMTA_TIMING_RESEARCH.md these are scenario
// modifiers, not hidden constants: each maps an admissible special operation to
// a multiplicative uncertainty in [0, 1] plus an additive seconds term.
const ACTUATION_UNCERTAINTY = 0.25;
const ACTUATION_ADD_SECONDS = 10;
const TRANSIT_PRIORITY_UNCERTAINTY = 0.2;
const TRANSIT_PRIORITY_ADD_SECONDS = 5;
const PREEMPTION_UNCERTAINTY = 0.4;
// A preemption call can dump the controller into emergency green for the
// responding vehicle, leaving cross-street red for nearly an extra cycle.
const PREEMPTION_ADD_SECONDS = 30;
const STALE_UNCERTAINTY = 0.25;

// Wall-clock fields of an ISO 8601 timestamp, read directly so that plan
// selection is independent of the host machine's timezone.
const ISO_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/;

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

/**
 * Returns local minutes after midnight and the JS day number (Sun = 0..Sat = 6)
 * for a departure time. When the input is an ISO string with an explicit
 * calendar date, the wall-clock fields are read directly so plan selection does
 * not depend on the host machine's timezone (a San Francisco "12:00" stays
 * minute 720 whether the process runs in UTC or Pacific). Date objects fall
 * back to the host timezone.
 */
function localMinuteAndDay(value: Date | string | undefined): { minute: number; day: number } | null {
  if (!value) return null;
  if (typeof value === "string") {
    const matched = ISO_PATTERN.exec(value);
    if (matched) {
      const [, yearText, monthText, dayText, hourText, minuteText, secondText] = matched;
      const year = Number(yearText);
      const month = Number(monthText);
      const day = Number(dayText);
      const hour = Number(hourText);
      const minute = Number(minuteText);
      const seconds = secondText ? Number(secondText) : 0;
      if ([year, month, day, hour, minute, seconds].some((part) => !Number.isFinite(part))) {
        return null;
      }
      const jsDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
      return { minute: hour * 60 + minute + seconds / 60, day: jsDay };
    }
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return { minute: date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60, day: date.getDay() };
}

function parseDepartureMs(value: Date | string | undefined): number {
  if (!value) return Number.NaN;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? ms : Number.NaN;
}

/**
 * Downgrades `current_official` evidence to `stale_official` when its recorded
 * `staleAfter` date has passed as of the route's departure time. Staleness is
 * evaluated against the supplied departure time, never the wall clock, so the
 * result stays deterministic. Per docs/METHODOLOGY.md: "current_official" is
 * official evidence whose recorded staleAfter has not passed.
 */
function reclassifyStale(
  kind: TimingKind,
  staleAfter: string | null | undefined,
  departureMs: number,
): TimingKind {
  if (kind === "current_official" && staleAfter && Number.isFinite(departureMs)) {
    const staleMs = Date.parse(staleAfter);
    if (Number.isFinite(staleMs) && staleMs < departureMs) return "stale_official";
  }
  return kind;
}

function inPlanWindow(minute: number, plan: TimingPlan): boolean {
  return plan.startMinute <= plan.endMinute
    ? minute >= plan.startMinute && minute < plan.endMinute
    : minute >= plan.startMinute || minute < plan.endMinute;
}

interface PlanSelection {
  plan: TimingPlan | null;
  hasPlans: boolean;
}

function selectPlan(evidence: SignalTimingEvidence, local: { minute: number; day: number } | null): PlanSelection {
  const plans = evidence.timeOfDayPlans;
  if (!plans?.length || !local) return { plan: null, hasPlans: false };
  const plan = plans.find((candidate) =>
    (!candidate.daysOfWeek || candidate.daysOfWeek.includes(local.day)) && inPlanWindow(local.minute, candidate),
  ) ?? null;
  return { plan, hasPlans: true };
}

/** Merges a selected plan's cycle/offset/windows over the signal-level evidence. */
function mergePlan(evidence: SignalTimingEvidence, plan: TimingPlan): SignalTimingEvidence {
  return {
    ...evidence,
    cycleSeconds: plan.cycleSeconds ?? evidence.cycleSeconds,
    cycleRangeSeconds: plan.cycleRangeSeconds ?? evidence.cycleRangeSeconds,
    offsetSeconds: plan.offsetSeconds ?? evidence.offsetSeconds,
    greenWindows: plan.greenWindows ?? evidence.greenWindows,
  };
}

interface EffectiveEvidence {
  evidence: SignalTimingEvidence;
  /**
   * True when time-of-day plans were supplied but none covered the departure
   * time. The signal is then treated conservatively as unknown for this
   * departure, because the presence of plans signals that timing varies by
   * time and a generic fallback cycle is likely wrong.
   */
  uncovered: boolean;
}

function effectiveEvidence(signal: RouteSignal, local: { minute: number; day: number } | null): EffectiveEvidence {
  const flat: SignalTimingEvidence = {
    timingKind: signal.timingKind,
    cycleSeconds: signal.cycleSeconds,
    cycleRangeSeconds: signal.cycleRangeSeconds,
    vehicleActuated: signal.vehicleActuated,
    pedestrianActuated: signal.pedestrianActuated,
    transitPriority: signal.transitPriority,
    emergencyPreemption: signal.emergencyPreemption,
    staleAfter: signal.staleAfter,
  };
  const base = signal.timing ?? flat;
  const { plan, hasPlans } = selectPlan(base, local);
  if (!hasPlans) return { evidence: base, uncovered: false };
  if (!plan) return { evidence: base, uncovered: true };
  return { evidence: mergePlan(base, plan), uncovered: false };
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

/**
 * Seconds until the next green window starts from a given phase. Correctly
 * handles green windows that do not begin at phase 0: the wait is the time to
 * the next window start, either later in the current cycle or, if none exists,
 * at the start of the next cycle.
 */
function waitUntilGreen(phase: number, cycle: number, windows: GreenWindow[]): number {
  if (windows.length === 0 || isGreen(phase, windows)) return 0;
  const starts = windows.map((window) => window.startSeconds).sort((a, b) => a - b);
  for (const start of starts) {
    if (start > phase) return start - phase;
  }
  return cycle - phase + starts[0];
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

  const departureMs = parseDepartureMs(input.departureTime);
  const local = localMinuteAndDay(input.departureTime);

  let expectedStops = 0;
  let expectedDelay = 0;
  let lowerStops = 0;
  let upperStops = 0;
  let lowerDelay = 0;
  let upperDelay = 0;
  let modeledSignals = 0;
  let unknownSignals = 0;
  let uncoveredSignals = 0;
  let actuatedCount = 0;
  let transitCount = 0;
  let preemptionCount = 0;
  let weakestConfidence = 2; // 2 = high, 1 = medium, 0 = low
  let specialOperationPresent = false;

  for (const [index, signal] of input.signals.entries()) {
    const { evidence: rawEvidence, uncovered } = effectiveEvidence(signal, local);
    const kind = reclassifyStale(
      rawEvidence.timingKind ?? "unknown",
      rawEvidence.staleAfter,
      departureMs,
    );

    if (uncovered || kind === "unknown") {
      unknownSignals += 1;
      if (uncovered) uncoveredSignals += 1;
      expectedStops += UNKNOWN_STOP_EXPECTED;
      expectedDelay += UNKNOWN_DELAY_EXPECTED;
      upperStops += UNKNOWN_STOP_UPPER;
      upperDelay += UNKNOWN_DELAY_UPPER;
      weakestConfidence = Math.min(weakestConfidence, 0);
      continue;
    }

    const cycle = normalizeCycle(rawEvidence.cycleSeconds)
      ?? (rawEvidence.cycleRangeSeconds ? normalizeCycle(rawEvidence.cycleRangeSeconds[0]) : null);

    if (!cycle) {
      // Evidence claims a kind but supplies no usable cycle length: the phase
      // cannot be evaluated, so fall back to the conservative unknown band.
      unknownSignals += 1;
      expectedStops += UNKNOWN_STOP_EXPECTED;
      expectedDelay += UNKNOWN_DELAY_EXPECTED;
      upperStops += UNKNOWN_STOP_UPPER;
      upperDelay += UNKNOWN_DELAY_UPPER;
      weakestConfidence = Math.min(weakestConfidence, 0);
      continue;
    }

    modeledSignals += 1;
    const offset = Number.isFinite(rawEvidence.offsetSeconds) ? (rawEvidence.offsetSeconds as number) : 0;
    const windows = normalizeWindows(rawEvidence.greenWindows, cycle);
    const arrival = arrivalFor(signal, index, input);
    const phase = phaseAt(arrival, cycle, offset);

    const range: [number, number] = rawEvidence.cycleRangeSeconds
      ? [
          normalizeCycle(rawEvidence.cycleRangeSeconds[0]) ?? cycle,
          normalizeCycle(rawEvidence.cycleRangeSeconds[1]) ?? cycle,
        ]
      : [cycle, cycle];

    const actuated = rawEvidence.vehicleActuated === true || rawEvidence.pedestrianActuated === true;
    const transitPriority = rawEvidence.transitPriority === true;
    const emergencyPreemption = rawEvidence.emergencyPreemption === true;
    if (actuated) actuatedCount += 1;
    if (transitPriority) transitCount += 1;
    if (emergencyPreemption) preemptionCount += 1;
    if (transitPriority || emergencyPreemption) specialOperationPresent = true;

    let uncertainty = 0;
    let additive = 0;
    if (actuated) {
      uncertainty = Math.max(uncertainty, ACTUATION_UNCERTAINTY);
      additive += ACTUATION_ADD_SECONDS;
    }
    if (transitPriority) {
      uncertainty = Math.max(uncertainty, TRANSIT_PRIORITY_UNCERTAINTY);
      additive += TRANSIT_PRIORITY_ADD_SECONDS;
    }
    if (emergencyPreemption) {
      uncertainty = Math.max(uncertainty, PREEMPTION_UNCERTAINTY);
      additive += PREEMPTION_ADD_SECONDS;
    }
    if (kind === "stale_official") uncertainty = Math.max(uncertainty, STALE_UNCERTAINTY);

    const greenRatio = windows.length > 0
      ? clamp(windows.reduce((sum, window) => sum + window.endSeconds - window.startSeconds, 0) / cycle, 0.05, 0.95)
      : 0.5;

    let expectedAtSignal: number;
    if (windows.length > 0) {
      const stopped = !isGreen(phase, windows);
      expectedAtSignal = stopped ? Math.max(0, waitUntilGreen(phase, cycle, windows)) : 0;
      expectedStops += stopped ? 1 : 0;
      lowerStops += stopped ? Math.max(0, 1 - uncertainty) : 0;
      upperStops += stopped ? 1 : uncertainty;
    } else {
      // No movement windows: model a random arrival under the green ratio.
      expectedAtSignal = (cycle * (1 - greenRatio)) / 2;
      expectedStops += 1 - greenRatio;
      lowerStops += Math.max(0, (1 - greenRatio) - uncertainty);
      upperStops += Math.min(1, (1 - greenRatio) + uncertainty);
    }

    expectedDelay += expectedAtSignal;
    lowerDelay += Math.max(0, expectedAtSignal * (1 - uncertainty));
    // Emergency preemption can cost nearly an extra cycle, so allow the upper
    // bound to exceed a single cycle when it is present.
    const ceiling = range[1] * (emergencyPreemption ? 2 : 1);
    upperDelay += Math.min(ceiling, expectedAtSignal * (1 + uncertainty) + additive);

    const kindWeight = kind === "current_official" || kind === "observed" ? 2 : kind === "stale_official" ? 1 : 0;
    weakestConfidence = Math.min(weakestConfidence, kindWeight);
  }

  // Transit priority and emergency preemption depend on live calls/preemptions
  // that a static plan cannot reveal, so their presence caps confidence.
  if (specialOperationPresent) weakestConfidence = Math.min(weakestConfidence, 1);

  const confidence: Confidence =
    weakestConfidence >= 2 && unknownSignals === 0
      ? "high"
      : weakestConfidence >= 1 && unknownSignals === 0
        ? "medium"
        : "low";

  const rationaleParts = [
    "Evaluates each signal against its supplied cycle, offset, and route arrival time.",
  ];
  if (modeledSignals) {
    rationaleParts.push(`${modeledSignals} signal${modeledSignals === 1 ? "" : "s"} had timing evidence.`);
  } else {
    rationaleParts.push("No usable timing evidence was supplied.");
  }
  if (unknownSignals) {
    rationaleParts.push(`${unknownSignals} signal${unknownSignals === 1 ? "" : "s"} remain unknown; their ranges are conservative.`);
  }
  if (uncoveredSignals) {
    rationaleParts.push(`${uncoveredSignals} signal${uncoveredSignals === 1 ? "" : "s"} had no time-of-day plan covering the departure time.`);
  }
  if (actuatedCount) rationaleParts.push("Actuation can extend or defer phases beyond the base plan.");
  if (transitCount) rationaleParts.push("Transit priority may change the published progression.");
  if (preemptionCount) rationaleParts.push("Emergency preemption can interrupt the published plan and add up to an extra cycle of delay.");

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
