import { z } from "zod";

import type { AreaStats } from "@/lib/contracts";
import { ApiError } from "@/lib/server/api-error";
import { query } from "@/lib/server/db";
import { getStaticStats } from "@/lib/server/static-data";

export type StatsArea = "sf" | "downtown";

interface StatsRow {
  signal_count: number | string;
  area_square_miles: number | string;
  road_miles: number | string | null;
  median_nearest_signal_feet: number | string | null;
  timing_coverage_percent: number | string;
  official_timing_percent: number | string;
  modeled_timing_percent: number | string;
}

const areaSchema = z.enum(["sf", "downtown"]);

// U.S. Census Bureau 2020 land-area figure. Downtown area is calculated from
// the versioned SF Planning C-3 polygon snapshot in PostGIS.
const SF_LAND_AREA_SQUARE_MILES = 46.91;

export function parseStatsArea(searchParams: URLSearchParams): StatsArea {
  const keys = [...searchParams.keys()];
  if (keys.some((key) => key !== "area") || searchParams.getAll("area").length > 1) {
    throw new ApiError(
      400,
      "invalid_query",
      "stats accepts exactly one optional query parameter: area.",
    );
  }

  const result = areaSchema.safeParse(searchParams.get("area") ?? "sf");
  if (!result.success) {
    throw new ApiError(
      400,
      "invalid_query",
      "area must be either sf or downtown.",
    );
  }
  return result.data;
}

export function buildStatsQuery(area: StatsArea): {
  text: string;
  values: unknown[];
} {
  return {
    text: `
      WITH study_area AS (
        SELECT geometry, area_square_miles
        FROM public.downtown_areas
        WHERE id = 'sf_c3_union'
      ),
      selected_signals AS MATERIALIZED (
        SELECT id, geometry, timing_kind
        FROM public.signal_catalog
        WHERE $1::text = 'sf' OR downtown IS TRUE
      ),
      signal_metrics AS (
        SELECT
          count(*)::integer AS signal_count,
          COALESCE(
            round(100.0 * count(*) FILTER (WHERE timing_kind <> 'unknown') / NULLIF(count(*), 0), 1),
            0
          ) AS timing_coverage_percent,
          COALESCE(
            round(100.0 * count(*) FILTER (
              WHERE timing_kind IN ('current_official', 'stale_official')
            ) / NULLIF(count(*), 0), 1),
            0
          ) AS official_timing_percent,
          COALESCE(
            round(100.0 * count(*) FILTER (WHERE timing_kind = 'modeled') / NULLIF(count(*), 0), 1),
            0
          ) AS modeled_timing_percent
        FROM selected_signals
      ),
      nearest_distances AS (
        SELECT (
          SELECT ST_Distance(signal.geometry::geography, other.geometry::geography)
          FROM selected_signals AS other
          WHERE other.id <> signal.id
          ORDER BY signal.geometry <-> other.geometry
          LIMIT 1
        ) * 3.280839895 AS nearest_feet
        FROM selected_signals AS signal
      ),
      road_metrics AS (
        SELECT SUM(
          CASE
            WHEN $1::text = 'sf' THEN ST_Length(road.geometry::geography)
            ELSE ST_Length(
              ST_CollectionExtract(
                ST_Intersection(road.geometry, study_area.geometry),
                2
              )::geography
            )
          END
        ) / 1609.344 AS road_miles
        FROM public.street_segments AS road
        CROSS JOIN study_area
        WHERE road.active IS TRUE
          AND (
            $1::text = 'sf'
            OR (
              road.geometry && study_area.geometry
              AND ST_Intersects(road.geometry, study_area.geometry)
            )
          )
      )
      SELECT
        signal_metrics.signal_count,
        CASE
          WHEN $1::text = 'sf' THEN ${SF_LAND_AREA_SQUARE_MILES}
          ELSE study_area.area_square_miles
        END AS area_square_miles,
        road_metrics.road_miles,
        (
          SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY nearest_feet)
          FROM nearest_distances
          WHERE nearest_feet IS NOT NULL
        ) AS median_nearest_signal_feet,
        signal_metrics.timing_coverage_percent,
        signal_metrics.official_timing_percent,
        signal_metrics.modeled_timing_percent
      FROM signal_metrics
      CROSS JOIN study_area
      CROSS JOIN road_metrics
    `,
    values: [area],
  };
}

function number(value: number | string): number {
  return Number(value);
}

export async function getAreaStats(area: StatsArea): Promise<AreaStats> {
  const statement = buildStatsQuery(area);
  let rows: StatsRow[];
  try {
    rows = await query<StatsRow>(statement.text, statement.values);
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== "database_unavailable") throw error;
    return getStaticStats(area);
  }
  const row = rows[0];
  if (!row) {
    throw new ApiError(
      503,
      "data_unavailable",
      "Study-area statistics are not available yet.",
    );
  }

  const signalCount = number(row.signal_count);
  const areaSquareMiles = number(row.area_square_miles);
  const roadMiles = row.road_miles === null ? 0 : number(row.road_miles);

  return {
    area,
    signalCount,
    areaSquareMiles,
    roadMiles,
    signalsPerSquareMile:
      areaSquareMiles > 0 ? Number((signalCount / areaSquareMiles).toFixed(2)) : 0,
    signalsPerRoadMile:
      roadMiles > 0 ? Number((signalCount / roadMiles).toFixed(2)) : 0,
    medianNearestSignalFeet:
      row.median_nearest_signal_feet === null
        ? null
        : number(row.median_nearest_signal_feet),
    timingCoveragePercent: number(row.timing_coverage_percent),
    officialTimingPercent: number(row.official_timing_percent),
    modeledTimingPercent: number(row.modeled_timing_percent),
    generatedAt: new Date().toISOString(),
  };
}
