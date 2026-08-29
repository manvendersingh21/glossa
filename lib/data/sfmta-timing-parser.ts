import type { Pool } from "pg";
import { SnapshotArchive } from "./sources";

export const SFMTA_TIMING_SCHEMA_VERSION = 1 as const;

/**
 * Evidence classification mirrored from `timing_estimates.evidence_kind` so a
 * reviewed SFMTA card integrates with the existing freshness model. A reviewed
 * public SFMTA timing card is official by default, but a reviewer may declare an
 * observation or modeled estimate instead.
 */
export type SfmtaEvidenceKind = "official" | "observed" | "modeled";

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
  /**
   * Freshness cutoff (YYYY-MM-DD). Required for `official` evidence, mirroring
   * `timing_estimates.CHECK (evidence_kind <> 'official' OR stale_after IS NOT NULL)`.
   * The derived `TimingKind` becomes `stale_official` once `now` passes this date.
   */
  staleAfter?: string;
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
  evidenceKind: SfmtaEvidenceKind;
  /**
   * Required when `evidenceKind` is `modeled` and forbidden otherwise, mirroring
   * `timing_estimates.CHECK ((evidence_kind = 'modeled') = (model_version IS NOT NULL))`.
   */
  modelVersion?: string;
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
const EVIDENCE_KINDS = new Set<SfmtaEvidenceKind>(["official", "observed", "modeled"]);
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
    staleAfter: raw.staleAfter === undefined ? undefined : date(raw.staleAfter, `${path}.staleAfter`),
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
  const evidenceKind = raw.evidenceKind === undefined
    ? "official"
    : stringValue(raw.evidenceKind, "evidenceKind") as SfmtaEvidenceKind;
  if (!EVIDENCE_KINDS.has(evidenceKind)) fail("evidenceKind", "must be official, observed, or modeled");
  const document: SfmtaTimingDocument = {
    schemaVersion: SFMTA_TIMING_SCHEMA_VERSION,
    importKey: stringValue(raw.importKey, "importKey"),
    evidenceKind,
    modelVersion: optionalString(raw.modelVersion, "modelVersion"),
    intersection: {
      cnn: stringValue(intersection.cnn, "intersection.cnn"), name: stringValue(intersection.name, "intersection.name"),
      system: optionalString(intersection.system, "intersection.system"), master: optionalString(intersection.master, "intersection.master"),
      controller: optionalString(intersection.controller, "intersection.controller"),
    },
    provenance: parseProvenance(raw.provenance), plans: raw.plans.map(parsePlan),
    reviewNotes: raw.reviewNotes === undefined ? undefined : stringArray(raw.reviewNotes, "reviewNotes"),
  };
  if (!/^\d+$/.test(document.intersection.cnn)) fail("intersection.cnn", "must contain digits only");
  if (document.evidenceKind === "official" && document.provenance.staleAfter === undefined) {
    fail("provenance.staleAfter", "is required for official evidence");
  }
  if (document.evidenceKind === "modeled" && document.modelVersion === undefined) {
    fail("modelVersion", "is required for modeled evidence");
  }
  if (document.evidenceKind !== "modeled" && document.modelVersion !== undefined) {
    fail("modelVersion", "is only valid for modeled evidence");
  }
  return document;
}

export type SfmtaConfidence = "high" | "medium" | "low" | "unknown";

/**
 * The cycle-level evidence that `importSfmtaTimingDocument` writes into the
 * existing `timing_estimates` table (migration 001). `cycleNominalSeconds`
 * holds the shared plan cycle when every plan agrees; otherwise the
 * `cycleMinSeconds`/`cycleMaxSeconds` range spans the plans, mirroring the
 * CSV importer's nominal-vs-range semantics and `timing_estimates` CHECKs.
 * `confidence` is derived from `evidenceKind` — official and observed reviewed
 * cards are `medium` (matching the existing 5th/Mission public-card row),
 * modeled cards are `low` — and `modelVersion` is required only for modeled
 * evidence, mirroring `timing_estimates.CHECK`s.
 */
export interface SfmtaTimingEstimateRow {
  importKey: string;
  cnn: string;
  evidenceKind: SfmtaEvidenceKind;
  cycleNominalSeconds: number | null;
  cycleMinSeconds: number | null;
  cycleMaxSeconds: number | null;
  confidence: SfmtaConfidence;
  modelVersion: string | null;
  rationale: string[];
}

const SFMTA_CONFIDENCE_BY_KIND: Record<SfmtaEvidenceKind, SfmtaConfidence> = {
  official: "medium",
  observed: "medium",
  modeled: "low",
};

/**
 * Project a reviewed SFMTA timing document into a `timing_estimates` evidence
 * row (cycle-level columns + rationale) without touching the database. The
 * full plan/phase model — offsets, weekday/time-of-day windows, phase green/
 * yellow/all-red intervals, pedestrian timing, actuation, transit priority,
 * and preemption — is preserved verbatim in `timing_estimates.raw_record` by
 * the importer so the signal-delay model can reconstruct every plan. Pure so
 * it can be unit-tested without a database.
 */
export function documentToTimingEstimate(document: SfmtaTimingDocument): SfmtaTimingEstimateRow {
  const cycles = document.plans.map((plan) => plan.cycleSeconds);
  const uniqueCycles = new Set(cycles);
  const cycleNominalSeconds = uniqueCycles.size === 1 ? cycles[0] : null;
  const cycleMinSeconds = uniqueCycles.size === 1 ? null : Math.min(...cycles);
  const cycleMaxSeconds = uniqueCycles.size === 1 ? null : Math.max(...cycles);
  const rationale: string[] = [];
  if (document.provenance.notes?.length) rationale.push(...document.provenance.notes);
  if (document.reviewNotes?.length) rationale.push(...document.reviewNotes);
  if (rationale.length === 0) {
    rationale.push(
      `Reviewed SFMTA timing card for ${document.intersection.name} (CNN ${document.intersection.cnn}).`,
    );
  }
  rationale.push(
    `${document.plans.length} time-of-day plan(s) preserved in raw_record; cycle evidence in cycle_nominal/range columns.`,
  );
  return {
    importKey: document.importKey,
    cnn: document.intersection.cnn,
    evidenceKind: document.evidenceKind,
    cycleNominalSeconds,
    cycleMinSeconds,
    cycleMaxSeconds,
    confidence: SFMTA_CONFIDENCE_BY_KIND[document.evidenceKind],
    modelVersion: document.modelVersion ?? null,
    rationale,
  };
}

export interface SfmtaTimingImportResult {
  importKey: string;
  cnn: string;
  plans: number;
  snapshotId: number;
}

/**
 * Persist a reviewed SFMTA timing document into the existing `timing_estimates`
 * table (migration 001) — one row per `import_key` — archiving the reviewed JSON
 * under the same raw-snapshot policy as network sources. The full plan/phase
 * model is preserved in `raw_record`; cycle evidence, `source_url`,
 * `source_as_of`, and the official `stale_after` cutoff land in queryable
 * columns so `signal_catalog` keeps surfacing cycle evidence and deriving
 * `current_official`/`stale_official`. Re-importing an `import_key` upserts
 * the row. Mirrors `importTimingCards` from `./timing-cards`.
 */
export async function importSfmtaTimingDocument(
  pool: Pool,
  document: SfmtaTimingDocument,
  archive: SnapshotArchive = new SnapshotArchive(),
): Promise<SfmtaTimingImportResult> {
  const sourceKey = "sfmta-timing-cards";
  const body = JSON.stringify(document, null, 2);
  const fetchedAt = new Date();
  const saved = await archive.save(sourceKey, body, fetchedAt, "json");
  const provenance = document.provenance;
  const row = documentToTimingEstimate(document);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const snapshot = await client.query<{ id: string }>(`
      INSERT INTO source_snapshots (
        source_key, source_url, fetched_at, source_updated_at, sha256, content_type,
        byte_count, row_count, archive_path, request, response, retained_until
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,'{}'::jsonb,$11)
      ON CONFLICT (source_key, sha256) DO UPDATE SET
        fetched_at = EXCLUDED.fetched_at, source_updated_at = EXCLUDED.source_updated_at,
        row_count = EXCLUDED.row_count, archive_path = EXCLUDED.archive_path,
        retained_until = EXCLUDED.retained_until
      RETURNING id
    `, [
      sourceKey,
      provenance.sourceUrl,
      fetchedAt.toISOString(),
      new Date(provenance.sourceAsOf).toISOString(),
      saved.sha256,
      "application/json",
      Buffer.byteLength(body),
      document.plans.length,
      saved.path,
      JSON.stringify({ importKey: document.importKey, reviewer: provenance.reviewer }),
      new Date(fetchedAt.valueOf() + Number(process.env.RAW_RETENTION_DAYS ?? 90) * 86_400_000).toISOString(),
    ]);
    const snapshotId = Number(snapshot.rows[0].id);
    await client.query(`
      INSERT INTO timing_estimates (
        cnn, evidence_kind, cycle_nominal_seconds, cycle_min_seconds,
        cycle_max_seconds, confidence, model_version, rationale, source_url,
        source_as_of, stale_after, source_snapshot_id, import_key, raw_record
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)
      ON CONFLICT (import_key) DO UPDATE SET
        cnn = EXCLUDED.cnn, evidence_kind = EXCLUDED.evidence_kind,
        cycle_nominal_seconds = EXCLUDED.cycle_nominal_seconds,
        cycle_min_seconds = EXCLUDED.cycle_min_seconds,
        cycle_max_seconds = EXCLUDED.cycle_max_seconds,
        confidence = EXCLUDED.confidence, model_version = EXCLUDED.model_version,
        rationale = EXCLUDED.rationale, source_url = EXCLUDED.source_url,
        source_as_of = EXCLUDED.source_as_of, stale_after = EXCLUDED.stale_after,
        source_snapshot_id = EXCLUDED.source_snapshot_id, raw_record = EXCLUDED.raw_record,
        imported_at = now()
    `, [
      row.cnn,
      row.evidenceKind,
      row.cycleNominalSeconds,
      row.cycleMinSeconds,
      row.cycleMaxSeconds,
      row.confidence,
      row.modelVersion,
      row.rationale,
      provenance.sourceUrl,
      new Date(provenance.sourceAsOf).toISOString(),
      provenance.staleAfter ? new Date(provenance.staleAfter).toISOString() : null,
      snapshotId,
      row.importKey,
      JSON.stringify(document),
    ]);
    await client.query("COMMIT");
    return { importKey: document.importKey, cnn: row.cnn, plans: document.plans.length, snapshotId };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
