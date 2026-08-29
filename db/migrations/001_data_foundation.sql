CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS schema_migrations (
  filename text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE source_definitions (
  source_key text PRIMARY KEY,
  name text NOT NULL,
  url text NOT NULL,
  attribution text NOT NULL,
  license text,
  expected_refresh interval,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  limitations text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO source_definitions (
  source_key, name, url, attribution, license, expected_refresh, capabilities, limitations
) VALUES
  (
    'datasf-traffic-signals',
    'DataSF Traffic Signals',
    'https://data.sfgov.org/resource/ybh5-27n2.geojson',
    'San Francisco Municipal Transportation Agency',
    'Open Data Commons Public Domain Dedication and License',
    interval '3 months',
    '{"inventory":true,"location":true,"equipment":true,"cycle_timing":false,"phase_timing":false,"live_state":false}'::jsonb,
    ARRAY['The current public inventory does not publish cycle length, phase timing, or live signal state.']
  ),
  (
    'datasf-streets',
    'DataSF Streets – Active and Retired',
    'https://data.sfgov.org/resource/3psu-pn9h.geojson',
    'City and County of San Francisco',
    'Open Data Commons Public Domain Dedication and License',
    interval '1 day',
    '{"centerlines":true,"cnn_nodes":true,"active_and_retired":true}'::jsonb,
    ARRAY[]::text[]
  ),
  (
    'sfplanning-c3-zoning',
    'SF Planning Zoning Map – Zoning Districts (C-3)',
    'https://sfplanninggis.org/arcgiswa/rest/services/PlanningData/MapServer/3',
    'San Francisco Planning Department',
    NULL,
    interval '3 months',
    '{"official_zoning":true,"downtown_definition":"union of C-3 zoning polygons"}'::jsonb,
    ARRAY['Downtown is an explicit analytical definition: the union of polygons whose zoning_sim starts with C-3.']
  ),
  (
    'openstreetmap-signals',
    'OpenStreetMap signal components in San Francisco relation 111968',
    'https://www.openstreetmap.org/relation/111968',
    'OpenStreetMap contributors',
    'ODbL 1.0',
    interval '1 day',
    '{"signal_components":true,"cross_street_context":true,"authoritative_intersections":false}'::jsonb,
    ARRAY['OSM elements are components, not authoritative intersection records; joins are probabilistic and retained with status and confidence.']
  ),
  (
    'timing-cards',
    'Imported signal timing cards',
    'local://data/reference/timing-cards',
    'User-supplied official, observed, or modeled evidence',
    NULL,
    NULL,
    '{"cycle_timing":true,"ranges":true,"provenance_required":true}'::jsonb,
    ARRAY['A timing row is never inferred from the Traffic Signals inventory; evidence kind and freshness are recorded explicitly.']
  )
ON CONFLICT (source_key) DO NOTHING;

CREATE TABLE ingest_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'failed')),
  requested_sources text[] NOT NULL DEFAULT ARRAY[]::text[],
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  CHECK ((status = 'running') = (completed_at IS NULL))
);

CREATE TABLE source_snapshots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_key text NOT NULL REFERENCES source_definitions(source_key),
  source_url text NOT NULL,
  fetched_at timestamptz NOT NULL,
  source_updated_at timestamptz,
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  content_type text NOT NULL,
  byte_count bigint NOT NULL CHECK (byte_count >= 0),
  row_count integer CHECK (row_count >= 0),
  archive_path text NOT NULL,
  request jsonb NOT NULL DEFAULT '{}'::jsonb,
  response jsonb NOT NULL DEFAULT '{}'::jsonb,
  retained_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_key, sha256)
);

CREATE INDEX source_snapshots_source_fetched_idx
  ON source_snapshots (source_key, fetched_at DESC);

CREATE TABLE downtown_zoning_polygons (
  object_id bigint PRIMARY KEY,
  zoning_code text NOT NULL CHECK (zoning_code LIKE 'C-3%'),
  district_name text,
  source_last_edited_at timestamptz,
  geometry geometry(MultiPolygon, 4326) NOT NULL,
  source_snapshot_id bigint NOT NULL REFERENCES source_snapshots(id),
  raw_properties jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX downtown_zoning_polygons_geometry_gix
  ON downtown_zoning_polygons USING gist (geometry);

CREATE TABLE downtown_areas (
  id text PRIMARY KEY,
  definition text NOT NULL,
  zoning_codes text[] NOT NULL,
  geometry geometry(MultiPolygon, 4326) NOT NULL,
  area_square_miles double precision GENERATED ALWAYS AS (
    ST_Area(geometry::geography) / 2589988.110336
  ) STORED,
  source_snapshot_id bigint NOT NULL REFERENCES source_snapshots(id),
  source_as_of timestamptz,
  generated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX downtown_areas_geometry_gix ON downtown_areas USING gist (geometry);

CREATE TABLE street_segments (
  cnn text PRIMARY KEY,
  street_name text NOT NULL,
  normalized_street_name text NOT NULL,
  from_street text,
  to_street text,
  from_node_cnn text,
  to_node_cnn text,
  class_code integer,
  active boolean NOT NULL,
  layer text,
  geometry geometry(Geometry, 4326) NOT NULL,
  source_as_of timestamptz,
  data_loaded_at timestamptz,
  source_snapshot_id bigint NOT NULL REFERENCES source_snapshots(id),
  raw_properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX street_segments_geometry_gix ON street_segments USING gist (geometry);
CREATE INDEX street_segments_from_node_idx ON street_segments (from_node_cnn);
CREATE INDEX street_segments_to_node_idx ON street_segments (to_node_cnn);
CREATE INDEX street_segments_normalized_name_idx ON street_segments (normalized_street_name);

CREATE TABLE intersections (
  cnn text PRIMARY KEY,
  object_id text,
  signal_number text,
  name text NOT NULL,
  street_names text[] NOT NULL,
  normalized_streets text[] NOT NULL,
  type text,
  detection text,
  vehicle_actuated boolean,
  pedestrian_signal boolean,
  pedestrian_actuated boolean,
  accessible_pedestrian_signal boolean,
  transit_priority boolean,
  emergency_preemption boolean,
  red_light_camera boolean,
  downtown boolean NOT NULL DEFAULT false,
  geometry geometry(Point, 4326) NOT NULL,
  inventory_as_of timestamptz,
  data_loaded_at timestamptz,
  inventory_snapshot_id bigint NOT NULL REFERENCES source_snapshots(id),
  raw_properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX intersections_geometry_gix ON intersections USING gist (geometry);
CREATE INDEX intersections_active_downtown_idx ON intersections (active, downtown);
CREATE INDEX intersections_normalized_streets_gin ON intersections USING gin (normalized_streets);

CREATE TABLE osm_signal_components (
  osm_type text NOT NULL CHECK (osm_type IN ('node', 'way', 'relation')),
  osm_id bigint NOT NULL,
  geometry geometry(Point, 4326) NOT NULL,
  tags jsonb NOT NULL DEFAULT '{}'::jsonb,
  nearby_streets text[] NOT NULL DEFAULT ARRAY[]::text[],
  normalized_streets text[] NOT NULL DEFAULT ARRAY[]::text[],
  intersection_cnn text REFERENCES intersections(cnn),
  match_status text NOT NULL CHECK (match_status IN ('matched', 'ambiguous', 'unmatched')),
  match_confidence text NOT NULL CHECK (match_confidence IN ('high', 'medium', 'low', 'unknown')),
  match_method text NOT NULL,
  distance_m double precision CHECK (distance_m IS NULL OR distance_m >= 0),
  street_overlap integer NOT NULL DEFAULT 0 CHECK (street_overlap >= 0),
  match_score double precision CHECK (match_score IS NULL OR match_score BETWEEN 0 AND 1),
  candidate_matches jsonb NOT NULL DEFAULT '[]'::jsonb,
  osm_as_of timestamptz NOT NULL,
  source_snapshot_id bigint NOT NULL REFERENCES source_snapshots(id),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (osm_type, osm_id),
  CHECK ((match_status = 'matched') = (intersection_cnn IS NOT NULL))
);

CREATE INDEX osm_signal_components_geometry_gix
  ON osm_signal_components USING gist (geometry);
CREATE INDEX osm_signal_components_intersection_idx
  ON osm_signal_components (intersection_cnn) WHERE intersection_cnn IS NOT NULL;
CREATE INDEX osm_signal_components_status_idx ON osm_signal_components (match_status);

CREATE TABLE timing_estimates (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cnn text NOT NULL REFERENCES intersections(cnn) ON DELETE CASCADE,
  evidence_kind text NOT NULL CHECK (evidence_kind IN ('official', 'observed', 'modeled')),
  cycle_nominal_seconds numeric(8, 3),
  cycle_min_seconds numeric(8, 3),
  cycle_max_seconds numeric(8, 3),
  confidence text NOT NULL CHECK (confidence IN ('high', 'medium', 'low', 'unknown')),
  model_version text,
  rationale text[] NOT NULL,
  source_url text NOT NULL,
  source_as_of timestamptz NOT NULL,
  stale_after timestamptz,
  source_snapshot_id bigint REFERENCES source_snapshots(id),
  imported_at timestamptz NOT NULL DEFAULT now(),
  import_key text NOT NULL UNIQUE,
  raw_record jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK (cycle_nominal_seconds IS NULL OR cycle_nominal_seconds > 0),
  CHECK ((cycle_min_seconds IS NULL) = (cycle_max_seconds IS NULL)),
  CHECK (cycle_min_seconds IS NULL OR (cycle_min_seconds > 0 AND cycle_max_seconds >= cycle_min_seconds)),
  CHECK (cycle_nominal_seconds IS NOT NULL OR cycle_min_seconds IS NOT NULL),
  CHECK (cycle_min_seconds IS NULL OR cycle_nominal_seconds IS NULL OR
    cycle_nominal_seconds BETWEEN cycle_min_seconds AND cycle_max_seconds),
  CHECK ((evidence_kind = 'modeled') = (model_version IS NOT NULL)),
  CHECK (evidence_kind <> 'official' OR stale_after IS NOT NULL)
);

CREATE INDEX timing_estimates_cnn_source_idx
  ON timing_estimates (cnn, source_as_of DESC);

COMMENT ON TABLE timing_estimates IS
  'Cycle timing evidence only. Official freshness is derived from stale_after; observed and modeled evidence remain distinct. Inventory data never populates this table.';

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
  i.geometry
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
  'One authoritative DataSF intersection per CNN, enriched with matched OSM component counts and one explicitly ranked timing evidence record.';
