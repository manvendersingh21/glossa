import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Pool } from "pg";
import { SnapshotArchive } from "./sources";

type EvidenceKind = "official" | "observed" | "modeled";
type Confidence = "high" | "medium" | "low" | "unknown";

export interface TimingCardRow {
  importKey: string;
  cnn: string;
  evidenceKind: EvidenceKind;
  cycleNominalSeconds: number | null;
  cycleMinSeconds: number | null;
  cycleMaxSeconds: number | null;
  confidence: Confidence;
  modelVersion: string | null;
  rationale: string[];
  sourceUrl: string;
  sourceAsOf: Date;
  staleAfter: Date | null;
  rawRecord: Record<string, string>;
}

export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n") {
      row.push(cell.replace(/\r$/, ""));
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (quoted) throw new Error("Unterminated quoted CSV field");
  row.push(cell.replace(/\r$/, ""));
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

function required(record: Record<string, string>, key: string, line: number): string {
  const value = record[key]?.trim();
  if (!value) throw new Error(`Timing CSV line ${line}: ${key} is required`);
  return value;
}

function numberOrNull(value: string | undefined, key: string, line: number): number | null {
  if (!value?.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Timing CSV line ${line}: ${key} must be a positive number`);
  }
  return parsed;
}

function dateValue(value: string, key: string, line: number): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) throw new Error(`Timing CSV line ${line}: ${key} is not a date`);
  return parsed;
}

export function parseTimingCards(input: string): TimingCardRow[] {
  const csvRows = parseCsv(input);
  if (csvRows.length === 0) throw new Error("Timing CSV is empty");
  const headers = csvRows[0].map((header) => header.trim());
  if (new Set(headers).size !== headers.length) throw new Error("Timing CSV contains duplicate headers");
  return csvRows.slice(1).map((values, index) => {
    const line = index + 2;
    const rawRecord = Object.fromEntries(headers.map((header, column) => [header, values[column] ?? ""]));
    const importKey = required(rawRecord, "import_key", line);
    const cnn = required(rawRecord, "cnn", line);
    if (!/^\d+$/.test(cnn)) throw new Error(`Timing CSV line ${line}: cnn must contain digits only`);
    const evidenceKind = required(rawRecord, "evidence_kind", line) as EvidenceKind;
    if (!["official", "observed", "modeled"].includes(evidenceKind)) {
      throw new Error(`Timing CSV line ${line}: invalid evidence_kind`);
    }
    const confidence = required(rawRecord, "confidence", line) as Confidence;
    if (!["high", "medium", "low", "unknown"].includes(confidence)) {
      throw new Error(`Timing CSV line ${line}: invalid confidence`);
    }
    const cycleNominalSeconds = numberOrNull(rawRecord.cycle_nominal_seconds, "cycle_nominal_seconds", line);
    const cycleMinSeconds = numberOrNull(rawRecord.cycle_min_seconds, "cycle_min_seconds", line);
    const cycleMaxSeconds = numberOrNull(rawRecord.cycle_max_seconds, "cycle_max_seconds", line);
    if (cycleNominalSeconds === null && cycleMinSeconds === null) {
      throw new Error(`Timing CSV line ${line}: nominal or range timing is required`);
    }
    if ((cycleMinSeconds === null) !== (cycleMaxSeconds === null)) {
      throw new Error(`Timing CSV line ${line}: cycle_min_seconds and cycle_max_seconds must be provided together`);
    }
    if (cycleMinSeconds !== null && cycleMaxSeconds !== null && cycleMinSeconds > cycleMaxSeconds) {
      throw new Error(`Timing CSV line ${line}: cycle_min_seconds exceeds cycle_max_seconds`);
    }
    if (cycleNominalSeconds !== null && cycleMinSeconds !== null && cycleMaxSeconds !== null
      && (cycleNominalSeconds < cycleMinSeconds || cycleNominalSeconds > cycleMaxSeconds)) {
      throw new Error(`Timing CSV line ${line}: nominal timing is outside the range`);
    }
    const modelVersion = rawRecord.model_version?.trim() || null;
    if (evidenceKind === "modeled" && !modelVersion) {
      throw new Error(`Timing CSV line ${line}: modeled evidence requires model_version`);
    }
    if (evidenceKind !== "modeled" && modelVersion) {
      throw new Error(`Timing CSV line ${line}: model_version is only valid for modeled evidence`);
    }
    const sourceAsOf = dateValue(required(rawRecord, "source_as_of", line), "source_as_of", line);
    const staleAfter = rawRecord.stale_after?.trim()
      ? dateValue(rawRecord.stale_after.trim(), "stale_after", line)
      : null;
    if (evidenceKind === "official" && !staleAfter) {
      throw new Error(`Timing CSV line ${line}: official evidence requires stale_after`);
    }
    const rationale = required(rawRecord, "rationale", line)
      .split("|")
      .map((item) => item.trim())
      .filter(Boolean);
    return {
      importKey,
      cnn,
      evidenceKind,
      cycleNominalSeconds,
      cycleMinSeconds,
      cycleMaxSeconds,
      confidence,
      modelVersion,
      rationale,
      sourceUrl: required(rawRecord, "source_url", line),
      sourceAsOf,
      staleAfter,
      rawRecord,
    };
  });
}

export async function importTimingCards(
  pool: Pool,
  filePath: string,
  archive = new SnapshotArchive(),
): Promise<{ imported: number; snapshotId: number }> {
  const absolutePath = path.resolve(filePath);
  const input = await readFile(absolutePath, "utf8");
  const rows = parseTimingCards(input);
  const fetchedAt = new Date();
  const saved = await archive.save("timing-cards", input, fetchedAt, "csv");
  const sha256 = createHash("sha256").update(input).digest("hex");
  const maxSourceAsOf = new Date(Math.max(...rows.map((row) => row.sourceAsOf.valueOf())));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const snapshot = await client.query<{ id: string }>(`
      INSERT INTO source_snapshots (
        source_key, source_url, fetched_at, source_updated_at, sha256, content_type,
        byte_count, row_count, archive_path, request, response, retained_until
      ) VALUES ('timing-cards',$1,$2,$3,$4,'text/csv',$5,$6,$7,$8::jsonb,'{}'::jsonb,$9)
      ON CONFLICT (source_key, sha256) DO UPDATE SET
        fetched_at=EXCLUDED.fetched_at, source_updated_at=EXCLUDED.source_updated_at,
        row_count=EXCLUDED.row_count, archive_path=EXCLUDED.archive_path,
        retained_until=EXCLUDED.retained_until
      RETURNING id
    `, [
      `local://timing-cards/${path.basename(absolutePath)}`,
      fetchedAt.toISOString(),
      maxSourceAsOf.toISOString(),
      sha256,
      Buffer.byteLength(input),
      rows.length,
      saved.path,
      JSON.stringify({ filename: path.basename(absolutePath) }),
      new Date(fetchedAt.valueOf() + Number(process.env.RAW_RETENTION_DAYS ?? 90) * 86_400_000).toISOString(),
    ]);
    const snapshotId = Number(snapshot.rows[0].id);
    for (const row of rows) {
      await client.query(`
        INSERT INTO timing_estimates (
          cnn, evidence_kind, cycle_nominal_seconds, cycle_min_seconds,
          cycle_max_seconds, confidence, model_version, rationale, source_url,
          source_as_of, stale_after, source_snapshot_id, import_key, raw_record
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)
        ON CONFLICT (import_key) DO UPDATE SET
          cnn=EXCLUDED.cnn, evidence_kind=EXCLUDED.evidence_kind,
          cycle_nominal_seconds=EXCLUDED.cycle_nominal_seconds,
          cycle_min_seconds=EXCLUDED.cycle_min_seconds,
          cycle_max_seconds=EXCLUDED.cycle_max_seconds,
          confidence=EXCLUDED.confidence, model_version=EXCLUDED.model_version,
          rationale=EXCLUDED.rationale, source_url=EXCLUDED.source_url,
          source_as_of=EXCLUDED.source_as_of, stale_after=EXCLUDED.stale_after,
          source_snapshot_id=EXCLUDED.source_snapshot_id, raw_record=EXCLUDED.raw_record,
          imported_at=now()
      `, [
        row.cnn,
        row.evidenceKind,
        row.cycleNominalSeconds,
        row.cycleMinSeconds,
        row.cycleMaxSeconds,
        row.confidence,
        row.modelVersion,
        row.rationale,
        row.sourceUrl,
        row.sourceAsOf.toISOString(),
        row.staleAfter?.toISOString() ?? null,
        snapshotId,
        row.importKey,
        JSON.stringify(row.rawRecord),
      ]);
    }
    await client.query("COMMIT");
    return { imported: rows.length, snapshotId };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

