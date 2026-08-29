-- Migration 002: register the reviewed SFMTA timing-card source.
--
-- The JSON importer (lib/data/sfmta-timing-parser.importSfmtaTimingDocument)
-- writes reviewed SFMTA plans into the EXISTING timing_estimates table from
-- migration 001 — one row per import_key — rather than a new evidence table.
-- cycle_nominal_seconds / cycle_min_seconds / cycle_max_seconds, source_url,
-- source_as_of, and the official stale_after cutoff land in queryable columns
-- (so signal_catalog keeps surfacing cycle evidence and deriving
-- current_official / stale_official exactly as it already does). Offsets,
-- weekday/time-of-day windows, phase green/yellow/all-red intervals,
-- pedestrian timing, actuation, transit priority, and preemption are
-- preserved verbatim in timing_estimates.raw_record (jsonb) for the
-- signal-delay model to reconstruct every plan.
--
-- This migration defines NO new tables. timing_estimates is NOT redefined and
-- signal_catalog is NOT modified (another agent owns time-of-day-plan columns
-- on it). It only registers the "sfmta-timing-cards" source that the importer's
-- source_snapshots row requires (source_snapshots.source_key REFERENCES
-- source_definitions.source_key). Idempotent; runs cleanly after 001.

INSERT INTO source_definitions (
  source_key, name, url, attribution, license, expected_refresh, capabilities, limitations
) VALUES (
  'sfmta-timing-cards',
  'SFMTA reviewed timing cards',
  'local://data/reference/sfmta-5th-mission-reviewed.json',
  'San Francisco Municipal Transportation Agency',
  NULL,
  NULL,
  '{"time_of_day_plans":true,"phases":true,"pedestrian_timing":true,"actuation":true,"transit_priority":true,"preemption":true,"provenance_required":true,"stale_after_required_for_official":true}'::jsonb,
  ARRAY['Reviewed timing cards are dated evidence, not live controller state; OCR is not trusted without human review.']
)
ON CONFLICT (source_key) DO NOTHING;
