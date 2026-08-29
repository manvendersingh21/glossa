import { query } from "@/lib/server/db";
import { ApiError } from "@/lib/server/api-error";
import { getStaticSources } from "@/lib/server/static-data";

export const PUBLIC_ATTRIBUTION = [
  "Traffic-signal inventory: San Francisco Municipal Transportation Agency via DataSF.",
  "Street centerlines and downtown C-3 zoning boundary: City and County of San Francisco.",
  "OpenStreetMap-derived component context: OpenStreetMap contributors (ODbL).",
  "Timing fields describe dated evidence or an explicit model; they are not a live controller feed.",
] as const;

interface SourceRow {
  source_key: string;
  name: string;
  url: string;
  attribution: string;
  license: string | null;
  expected_refresh: string | null;
  capabilities: unknown;
  limitations: string[];
  fetched_at: string | Date | null;
  source_as_of: string | Date | null;
  row_count: number | null;
}

export interface SourceSummary {
  name: string;
  asOf: string | null;
  url: string;
}

export interface SourceMetadata extends SourceSummary {
  key: string;
  attribution: string;
  license: string | null;
  expectedRefresh: string | null;
  capabilities: unknown;
  limitations: string[];
  fetchedAt: string | null;
  rowCount: number | null;
}

const SOURCE_QUERY = `
  SELECT
    definitions.source_key,
    definitions.name,
    definitions.url,
    definitions.attribution,
    definitions.license,
    definitions.expected_refresh::text,
    definitions.capabilities,
    definitions.limitations,
    snapshot.fetched_at,
    COALESCE(snapshot.source_updated_at, snapshot.fetched_at) AS source_as_of,
    snapshot.row_count
  FROM public.source_definitions AS definitions
  LEFT JOIN LATERAL (
    SELECT
      source_snapshots.fetched_at,
      source_snapshots.source_updated_at,
      source_snapshots.row_count
    FROM public.source_snapshots
    WHERE source_snapshots.source_key = definitions.source_key
    ORDER BY source_snapshots.fetched_at DESC, source_snapshots.id DESC
    LIMIT 1
  ) AS snapshot ON TRUE
  ORDER BY definitions.source_key ASC
`;

function dateString(value: string | Date | null): string | null {
  if (value === null) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : value;
}

export async function getSources(): Promise<SourceMetadata[]> {
  let rows: SourceRow[];
  try {
    rows = await query<SourceRow>(SOURCE_QUERY);
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== "database_unavailable") throw error;
    return getStaticSources();
  }
  return rows.map((row) => ({
    key: row.source_key,
    name: row.name,
    url: row.url,
    attribution: row.attribution,
    license: row.license,
    expectedRefresh: row.expected_refresh,
    capabilities: row.capabilities,
    limitations: row.limitations,
    fetchedAt: dateString(row.fetched_at),
    asOf: dateString(row.source_as_of),
    rowCount: row.row_count,
  }));
}

export async function getSourceMetadata(): Promise<SourceSummary[]> {
  const sources = await getSources();
  return sources.map(({ name, asOf, url }) => ({ name, asOf, url }));
}
