export const SFMTA_TIMING_SCHEMA_VERSION = 1 as const;

export type SfmtaDay =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export type ExtractionMethod = "manual_review" | "structured_source";

export interface TimingProvenance {
  sourceUrl: string;
  localFile: string;
  sourceAsOf: string;
  planDate?: string;
  revisionDate?: string;
  pageNumbers: number[];
  extractionMethod: ExtractionMethod;
  reviewedAt: string;
  reviewer: string;
  sha256?: string;
  notes?: string[];
}

export interface PhaseInterval {
  phase: number;
  movement: string;
  approach?: string;
  greenStartSeconds: number;
  greenEndSeconds: number;
  yellowSeconds?: number;
  allRedSeconds?: number;
  walkSeconds?: number;
  pedestrianClearanceSeconds?: number;
  recall?: "none" | "minimum" | "maximum" | "pedestrian";
  minimumGreenSeconds?: number;
  maximumGreenSeconds?: number;
  vehicleExtensionSeconds?: number;
  minimumGapSeconds?: number;
}

export interface ActuationRules {
  mode: "fixed" | "semi_actuated" | "fully_actuated" | "adaptive" | "unknown";
  vehicleDetection?: boolean;
  pedestrianDetection?: boolean;
  minimumInitialSeconds?: number;
  vehicleExtensionSeconds?: number;
  minimumGapSeconds?: number;
  notes?: string[];
}

export interface TransitPriorityRules {
  enabled: boolean;
  modes?: string[];
  behavior?: "hold_green" | "early_green" | "shorten_red" | "unknown";
  notes?: string[];
}

export interface PreemptionRules {
  enabled: boolean;
  modes?: string[];
  behavior?: "emergency" | "rail" | "fire" | "unknown";
  notes?: string[];
}

export interface SfmtaTimeOfDayPlan {
  id: string;
  label: string;
  days: SfmtaDay[];
  startTime: string;
  endTime?: string;
  cycleSeconds: number;
  offsetSeconds: number;
  offsetReference?: string;
  phaseSequence: number[];
  phaseIntervals: PhaseInterval[];
  actuation?: ActuationRules;
  transitPriority?: TransitPriorityRules;
  preemption?: PreemptionRules;
  clockResetTime?: string;
  notes?: string[];
}

export interface SfmtaTimingDocument {
  schemaVersion: typeof SFMTA_TIMING_SCHEMA_VERSION;
  importKey: string;
  intersection: {
    cnn: string;
    name: string;
    system?: string;
    master?: string;
    controller?: string;
  };
  provenance: TimingProvenance;
  plans: SfmtaTimeOfDayPlan[];
  reviewNotes?: string[];
}

const DAYS = new Set<SfmtaDay>([
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
]);
const EXTRACTION_METHODS = new Set<ExtractionMethod>(["manual_review", "structured_source"]);
const ACTUATION_MODES = new Set<ActuationRules["mode"]>([
  "fixed", "semi_actuated", "fully_actuated", "adaptive", "unknown",
]);
const CLOCK_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

function fail(path: string, message: string): never {
  throw new Error(`SFMTA timing ${path}: ${message}`);
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(path, "must be an object");
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, path: string, nonEmpty = true): string {
  if (typeof value !== "string" || (nonEmpty && value.trim() === "")) fail(path, "must be a non-empty string");
  return value.trim();
}

function optionalString(value: unknown, path: string): string | undefined {
  return value === undefined ? undefined : stringValue(value, path);
}

function positive(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) fail(path, "must be a positive number");
  return value;
}

function optionalPositive(value: unknown, path: string): number | undefined {
  return value === undefined ? undefined : positive(value, path);
}

function integer(value: unknown, path: string, minimum = 0): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum) fail(path, `must be an integer >= ${minimum}`);
  return value;
}

function date(value: unknown, path: string): string {
  const parsed = stringValue(value, path);
  if (!DATE_PATTERN.test(parsed) || Number.isNaN(Date.parse(`${parsed}T00:00:00Z`))) fail(path, "must use YYYY-MM-DD");
  return parsed;
}

function clock(value: unknown, path: string): string {
  const parsed = stringValue(value, path);
  if (parsed !== "24:00" && !CLOCK_PATTERN.test(parsed)) fail(path, "must use HH:mm in 24-hour time");
  return parsed;
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) fail(path, "must be an array");
  return value.map((item, index) => stringValue(item, `${path}[${index}]`));
}

function parsePhase(value: unknown, path: string, cycleSeconds: number): PhaseInterval {
  const raw = object(value, path);
  const phase = integer(raw.phase, `${path}.phase`, 1);
  const movement = stringValue(raw.movement, `${path}.movement`);
  const greenStartSeconds = integer(raw.greenStartSeconds, `${path}.greenStartSeconds`);
  const greenEndSeconds = integer(raw.greenEndSeconds, `${path}.greenEndSeconds`, 1);
  if (greenEndSeconds <= greenStartSeconds || greenEndSeconds > cycleSeconds) {
    fail(path, "green interval must be within the cycle and end after it starts");
  }
  const phaseInterval: PhaseInterval = {
    phase, movement,
    approach: optionalString(raw.approach, `${path}.approach`),
    greenStartSeconds, greenEndSeconds,
    yellowSeconds: optionalPositive(raw.yellowSeconds, `${path}.yellowSeconds`),
    allRedSeconds: optionalPositive(raw.allRedSeconds, `${path}.allRedSeconds`),
    walkSeconds: optionalPositive(raw.walkSeconds, `${path}.walkSeconds`),
    pedestrianClearanceSeconds: optionalPositive(raw.pedestrianClearanceSeconds, `${path}.pedestrianClearanceSeconds`),
    recall: raw.recall as PhaseInterval["recall"],
    minimumGreenSeconds: optionalPositive(raw.minimumGreenSeconds, `${path}.minimumGreenSeconds`),
    maximumGreenSeconds: optionalPositive(raw.maximumGreenSeconds, `${path}.maximumGreenSeconds`),
    vehicleExtensionSeconds: optionalPositive(raw.vehicleExtensionSeconds, `${path}.vehicleExtensionSeconds`),
    minimumGapSeconds: optionalPositive(raw.minimumGapSeconds, `${path}.minimumGapSeconds`),
  };
  if (phaseInterval.recall !== undefined && !["none", "minimum", "maximum", "pedestrian"].includes(phaseInterval.recall)) {
    fail(`${path}.recall`, "must be a supported recall mode");
  }
  if (phaseInterval.minimumGreenSeconds !== undefined && phaseInterval.maximumGreenSeconds !== undefined
    && phaseInterval.minimumGreenSeconds > phaseInterval.maximumGreenSeconds) {
    fail(path, "minimum green cannot exceed maximum green");
  }
  return phaseInterval;
}

function parseRules(value: unknown, path: string): ActuationRules {
  const raw = object(value, path);
  const mode = stringValue(raw.mode, `${path}.mode`) as ActuationRules["mode"];
  if (!ACTUATION_MODES.has(mode)) fail(`${path}.mode`, "must be a supported actuation mode");
  return {
    mode,
    vehicleDetection: raw.vehicleDetection as boolean | undefined,
    pedestrianDetection: raw.pedestrianDetection as boolean | undefined,
    minimumInitialSeconds: optionalPositive(raw.minimumInitialSeconds, `${path}.minimumInitialSeconds`),
    vehicleExtensionSeconds: optionalPositive(raw.vehicleExtensionSeconds, `${path}.vehicleExtensionSeconds`),
    minimumGapSeconds: optionalPositive(raw.minimumGapSeconds, `${path}.minimumGapSeconds`),
    notes: raw.notes === undefined ? undefined : stringArray(raw.notes, `${path}.notes`),
  };
}

function parsePriority(value: unknown, path: string): TransitPriorityRules {
  const raw = object(value, path);
  const enabled = optionalBoolean(raw.enabled, `${path}.enabled`);
  if (enabled === undefined) fail(`${path}.enabled`, "is required");
  const behavior = raw.behavior as TransitPriorityRules["behavior"] | undefined;
  if (behavior !== undefined && !["hold_green", "early_green", "shorten_red", "unknown"].includes(behavior)) {
    fail(`${path}.behavior`, "must be a supported transit-priority behavior");
  }
  return { enabled, modes: raw.modes === undefined ? undefined : stringArray(raw.modes, `${path}.modes`), behavior,
    notes: raw.notes === undefined ? undefined : stringArray(raw.notes, `${path}.notes`) };
}

function parsePreemption(value: unknown, path: string): PreemptionRules {
  const raw = object(value, path);
  const enabled = optionalBoolean(raw.enabled, `${path}.enabled`);
  if (enabled === undefined) fail(`${path}.enabled`, "is required");
  const behavior = raw.behavior as PreemptionRules["behavior"] | undefined;
  if (behavior !== undefined && !["emergency", "rail", "fire", "unknown"].includes(behavior)) {
    fail(`${path}.behavior`, "must be a supported preemption behavior");
  }
  return { enabled, modes: raw.modes === undefined ? undefined : stringArray(raw.modes, `${path}.modes`), behavior,
    notes: raw.notes === undefined ? undefined : stringArray(raw.notes, `${path}.notes`) };
}

function optionalBoolean(value: unknown, path: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") fail(path, "must be a boolean");
  return value;
}

function parsePlan(value: unknown, index: number): SfmtaTimeOfDayPlan {
  const path = `plans[${index}]`;
  const raw = object(value, path);
  const cycleSeconds = positive(raw.cycleSeconds, `${path}.cycleSeconds`);
  if (cycleSeconds < 30 || cycleSeconds > 300) fail(`${path}.cycleSeconds`, "must be between 30 and 300 seconds");
  const offsetSeconds = integer(raw.offsetSeconds, `${path}.offsetSeconds`);
  if (offsetSeconds >= cycleSeconds) fail(`${path}.offsetSeconds`, "must be less than cycleSeconds");
  if (!Array.isArray(raw.days) || raw.days.length === 0) fail(`${path}.days`, "must contain at least one day");
  const days = raw.days.map((day, dayIndex) => {
    const parsed = stringValue(day, `${path}.days[${dayIndex}]`) as SfmtaDay;
    if (!DAYS.has(parsed)) fail(`${path}.days[${dayIndex}]`, "must be a lowercase weekday");
    return parsed;
  });
  if (new Set(days).size !== days.length) fail(`${path}.days`, "must not contain duplicates");
  if (!Array.isArray(raw.phaseSequence)) fail(`${path}.phaseSequence`, "must be an array");
  const phaseSequence = raw.phaseSequence.map((phase, phaseIndex) => integer(phase, `${path}.phaseSequence[${phaseIndex}]`, 1));
  if (!Array.isArray(raw.phaseIntervals)) fail(`${path}.phaseIntervals`, "must be an array");
  const phaseIntervals = raw.phaseIntervals.map((phase, phaseIndex) => parsePhase(phase, `${path}.phaseIntervals[${phaseIndex}]`, cycleSeconds));
  const phaseNumbers = new Set(phaseIntervals.map((phase) => phase.phase));
  if (phaseSequence.some((phase) => !phaseNumbers.has(phase)) && phaseIntervals.length > 0) {
    fail(`${path}.phaseSequence`, "must reference phase intervals present in the plan");
  }
  const plan: SfmtaTimeOfDayPlan = {
    id: stringValue(raw.id, `${path}.id`), label: stringValue(raw.label, `${path}.label`), days,
    startTime: clock(raw.startTime, `${path}.startTime`),
    endTime: raw.endTime === undefined ? undefined : clock(raw.endTime, `${path}.endTime`),
    cycleSeconds, offsetSeconds, offsetReference: optionalString(raw.offsetReference, `${path}.offsetReference`),
    phaseSequence, phaseIntervals,
    actuation: raw.actuation === undefined ? undefined : parseRules(raw.actuation, `${path}.actuation`),
    transitPriority: raw.transitPriority === undefined ? undefined : parsePriority(raw.transitPriority, `${path}.transitPriority`),
    preemption: raw.preemption === undefined ? undefined : parsePreemption(raw.preemption, `${path}.preemption`),
    clockResetTime: raw.clockResetTime === undefined ? undefined : clock(raw.clockResetTime, `${path}.clockResetTime`),
    notes: raw.notes === undefined ? undefined : stringArray(raw.notes, `${path}.notes`),
  };
  if (plan.endTime === plan.startTime) fail(`${path}.endTime`, "must differ from startTime");
  return plan;
}

function parseProvenance(value: unknown): TimingProvenance {
  const path = "provenance";
  const raw = object(value, path);
  const pageNumbers = raw.pageNumbers;
  if (!Array.isArray(pageNumbers) || pageNumbers.length === 0) fail(`${path}.pageNumbers`, "must contain at least one page");
  const pages = pageNumbers.map((page, index) => integer(page, `${path}.pageNumbers[${index}]`, 1));
  const extractionMethod = stringValue(raw.extractionMethod, `${path}.extractionMethod`) as ExtractionMethod;
  if (!EXTRACTION_METHODS.has(extractionMethod)) fail(`${path}.extractionMethod`, "must be manual_review or structured_source");
  const sha256 = optionalString(raw.sha256, `${path}.sha256`);
  if (sha256 && !SHA256_PATTERN.test(sha256)) fail(`${path}.sha256`, "must be a SHA-256 hex digest");
  return {
    sourceUrl: stringValue(raw.sourceUrl, `${path}.sourceUrl`), localFile: stringValue(raw.localFile, `${path}.localFile`),
    sourceAsOf: date(raw.sourceAsOf, `${path}.sourceAsOf`),
    planDate: raw.planDate === undefined ? undefined : date(raw.planDate, `${path}.planDate`),
    revisionDate: raw.revisionDate === undefined ? undefined : date(raw.revisionDate, `${path}.revisionDate`),
    pageNumbers: pages, extractionMethod, reviewedAt: stringValue(raw.reviewedAt, `${path}.reviewedAt`),
    reviewer: stringValue(raw.reviewer, `${path}.reviewer`), sha256,
    notes: raw.notes === undefined ? undefined : stringArray(raw.notes, `${path}.notes`),
  };
}

export function parseSfmtaTimingDocument(input: unknown): SfmtaTimingDocument {
  let value = input;
  if (typeof input === "string") {
    try { value = JSON.parse(input) as unknown; } catch { fail("document", "must contain valid JSON"); }
  }
  const raw = object(value, "document");
  if (raw.schemaVersion !== SFMTA_TIMING_SCHEMA_VERSION) fail("schemaVersion", `must be ${SFMTA_TIMING_SCHEMA_VERSION}`);
  if (!Array.isArray(raw.plans) || raw.plans.length === 0) fail("plans", "must contain at least one plan");
  const intersection = object(raw.intersection, "intersection");
  const document: SfmtaTimingDocument = {
    schemaVersion: SFMTA_TIMING_SCHEMA_VERSION,
    importKey: stringValue(raw.importKey, "importKey"),
    intersection: {
      cnn: stringValue(intersection.cnn, "intersection.cnn"), name: stringValue(intersection.name, "intersection.name"),
      system: optionalString(intersection.system, "intersection.system"), master: optionalString(intersection.master, "intersection.master"),
      controller: optionalString(intersection.controller, "intersection.controller"),
    },
    provenance: parseProvenance(raw.provenance), plans: raw.plans.map(parsePlan),
    reviewNotes: raw.reviewNotes === undefined ? undefined : stringArray(raw.reviewNotes, "reviewNotes"),
  };
  if (!/^\d+$/.test(document.intersection.cnn)) fail("intersection.cnn", "must contain digits only");
  return document;
}
