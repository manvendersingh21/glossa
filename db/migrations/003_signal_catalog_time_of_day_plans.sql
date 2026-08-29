-- 003_signal_catalog_time_of_day_plans.sql
--
-- Wires the SFMTA timing-card parser's plan-level output (cycle, offset, day/time
-- windows, and phase intervals) into the PostgreSQL signal inventory so the route
-- estimate can feed the signal delay model with arrival-time-aware phase
-- positioning.
--
-- This migration owns ONLY the optional plan schedule on the existing
-- timing_estimates table. It does NOT redefine timing_estimates and does NOT add
-- any signal_timing_* tables (those are owned by 002, sequenced before this file).
-- The master apply order is 001 -> 002 -> 003.
--
-- The reviewed parser fixture (data/reference/sfmta-5th-mission-reviewed.json)
-- notes that timing_estimates previously stored only cycle-level evidence. This
-- migration adds an optional plan schedule, keeping cycle-only evidence as the
-- baseline: the column is nullable and consumed only when plan-level evidence has
-- been imported. The phase model is intentionally not asserted as live state; it
-- is labeled evidence used by a deterministic model.

ALTER TABLE timing_estimates
  ADD COLUMN IF NOT EXISTS time_of_day_plans jsonb
    CHECK (time_of_day_plans IS NULL OR jsonb_typeof(time_of_day_plans) = 'array');

COMMENT ON COLUMN timing_estimates.time_of_day_plans IS
  'Optional array of time-of-day plans in the SFMTA timing-card shape (cycle, offset, day/time windows, phase intervals). Nullable; absence falls back to cycle-only signal evidence. Never populated from the DataSF inventory.';

-- Re-expose the plan schedule through signal_catalog so route estimates can select
-- it alongside the ranked timing record. CREATE OR REPLACE VIEW is required to add
-- a view column. PostgreSQL only allows new view columns to be APPENDED after the
-- existing ones; the new column is therefore placed last and the original 29
-- columns from 001 keep their exact order and types. Consumers select columns by
-- name, so the appended ordinal position does not affect the application.
CREATE OR REPLACE VIEW signal_catalog AS
WITH component_summary AS (
  SELECT
    intersection_cnn AS cnn,
    count(*)::integer AS osm_component_count,
    max(osm_as_of) AS osm_as_of
  FROM osm_signal_components
  WHERE match_status = 'matched'
  GROUP BY intersection_cnn
)
SELECT
  i.cnn AS id,
  i.cnn,
  i.signal_number,
  i.name,
  ST_X(i.geometry) AS longitude,
  ST_Y(i.geometry) AS latitude,
  i.downtown,
  i.type,
  i.detection,
  i.vehicle_actuated,
  i.pedestrian_signal,
  i.pedestrian_actuated,
  i.accessible_pedestrian_signal,
  i.transit_priority,
  i.emergency_preemption,
  i.red_light_camera,
  COALESCE(cs.osm_component_count, 0) AS osm_component_count,
  COALESCE(t.timing_kind, 'unknown') AS timing_kind,
  t.cycle_nominal_seconds::double precision AS cycle_seconds,
  t.cycle_min_seconds::double precision AS cycle_min_seconds,
  t.cycle_max_seconds::double precision AS cycle_max_seconds,
  COALESCE(t.confidence, 'unknown') AS confidence,
  t.model_version,
  COALESCE(
    t.rationale,
    ARRAY['No cycle or phase timing is published by the current DataSF Traffic Signals inventory, and no separate timing evidence has been imported.']::text[]
  ) AS rationale,
  t.source_url,
  t.source_as_of,
  i.inventory_as_of,
  cs.osm_as_of,
  i.geometry,
  -- Appended last (position 30): the new plan-schedule column. See the header
  -- note for why CREATE OR REPLACE VIEW requires appending, not inserting.
  t.time_of_day_plans
FROM intersections i
LEFT JOIN component_summary cs ON cs.cnn = i.cnn
LEFT JOIN LATERAL (
  SELECT ranked.*
  FROM (
    SELECT
      te.*,
      CASE
        WHEN te.evidence_kind = 'official' AND now() <= te.stale_after THEN 'current_official'
        WHEN te.evidence_kind = 'official' THEN 'stale_official'
        WHEN te.evidence_kind = 'observed' THEN 'observed'
        WHEN te.evidence_kind = 'modeled' THEN 'modeled'
      END AS timing_kind,
      CASE
        WHEN te.evidence_kind = 'official' AND now() <= te.stale_after THEN 1
        WHEN te.evidence_kind = 'official' THEN 2
        WHEN te.evidence_kind = 'observed' THEN 3
        WHEN te.evidence_kind = 'modeled' THEN 4
      END AS evidence_rank
    FROM timing_estimates te
    WHERE te.cnn = i.cnn
  ) ranked
  ORDER BY ranked.evidence_rank, ranked.source_as_of DESC, ranked.imported_at DESC
  LIMIT 1
) t ON true
WHERE i.active;

COMMENT ON VIEW signal_catalog IS
  'One authoritative DataSF intersection per CNN, enriched with matched OSM component counts, one explicitly ranked timing evidence record, and an optional time-of-day plan schedule consumed by the signal delay model.';
