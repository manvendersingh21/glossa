import type { Pool, PoolClient } from "pg";
import type { PreparedData } from "./pipeline";
import type { LoadedSources, SnapshotPayload } from "./types";

function chunks<T>(values: T[], size = 500): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

async function recordSnapshot(
  client: PoolClient,
  snapshot: SnapshotPayload<unknown>,
): Promise<number> {
  const result = await client.query<{ id: string }>(`
    INSERT INTO source_snapshots (
      source_key, source_url, fetched_at, source_updated_at, sha256, content_type,
      byte_count, row_count, archive_path, request, response, retained_until
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12)
    ON CONFLICT (source_key, sha256) DO UPDATE SET
      fetched_at = EXCLUDED.fetched_at,
      source_updated_at = EXCLUDED.source_updated_at,
      byte_count = EXCLUDED.byte_count,
      row_count = EXCLUDED.row_count,
      archive_path = EXCLUDED.archive_path,
      request = EXCLUDED.request,
      response = EXCLUDED.response,
      retained_until = EXCLUDED.retained_until
    RETURNING id
  `, [
    snapshot.sourceKey,
    snapshot.sourceUrl,
    snapshot.fetchedAt.toISOString(),
    iso(snapshot.sourceUpdatedAt),
    snapshot.sha256,
    snapshot.contentType,
    snapshot.byteCount,
    snapshot.rowCount,
    snapshot.archivePath,
    JSON.stringify(snapshot.request),
    JSON.stringify({ ...snapshot.response, fromCache: snapshot.fromCache }),
    new Date(snapshot.fetchedAt.valueOf() + Number(process.env.RAW_RETENTION_DAYS ?? 90) * 86_400_000).toISOString(),
  ]);
  return Number(result.rows[0].id);
}

async function loadIntersections(
  client: PoolClient,
  prepared: PreparedData,
  snapshotId: number,
): Promise<void> {
  await client.query("UPDATE intersections SET active = false");
  for (const batch of chunks(prepared.intersections)) {
    const records = batch.map((row) => ({
      cnn: row.cnn,
      object_id: row.objectId,
      signal_number: row.signalNumber,
      name: row.name,
      street_names: row.streetNames,
      normalized_streets: row.normalizedStreets,
      type: row.type,
      detection: row.detection,
      vehicle_actuated: row.vehicleActuated,
      pedestrian_signal: row.pedestrianSignal,
      pedestrian_actuated: row.pedestrianActuated,
      accessible_pedestrian_signal: row.accessiblePedestrianSignal,
      transit_priority: row.transitPriority,
      emergency_preemption: row.emergencyPreemption,
      red_light_camera: row.redLightCamera,
      longitude: row.coordinates[0],
      latitude: row.coordinates[1],
      inventory_as_of: iso(row.inventoryAsOf),
      data_loaded_at: iso(row.dataLoadedAt),
      raw_properties: row.rawProperties,
    }));
    await client.query(`
      INSERT INTO intersections (
        cnn, object_id, signal_number, name, street_names, normalized_streets, type,
        detection, vehicle_actuated, pedestrian_signal, pedestrian_actuated,
        accessible_pedestrian_signal, transit_priority, emergency_preemption,
        red_light_camera, geometry, inventory_as_of, data_loaded_at,
        inventory_snapshot_id, raw_properties, active, last_seen_at
      )
      SELECT
        x.cnn, x.object_id, x.signal_number, x.name, x.street_names, x.normalized_streets,
        x.type, x.detection, x.vehicle_actuated, x.pedestrian_signal,
        x.pedestrian_actuated, x.accessible_pedestrian_signal, x.transit_priority,
        x.emergency_preemption, x.red_light_camera,
        ST_SetSRID(ST_MakePoint(x.longitude, x.latitude), 4326),
        x.inventory_as_of, x.data_loaded_at, $2, x.raw_properties, true, now()
      FROM jsonb_to_recordset($1::jsonb) AS x(
        cnn text, object_id text, signal_number text, name text, street_names text[],
        normalized_streets text[], type text, detection text, vehicle_actuated boolean,
        pedestrian_signal boolean, pedestrian_actuated boolean,
        accessible_pedestrian_signal boolean, transit_priority boolean,
        emergency_preemption boolean, red_light_camera boolean, longitude double precision,
        latitude double precision, inventory_as_of timestamptz, data_loaded_at timestamptz,
        raw_properties jsonb
      )
      ON CONFLICT (cnn) DO UPDATE SET
        object_id = EXCLUDED.object_id,
        signal_number = EXCLUDED.signal_number,
        name = EXCLUDED.name,
        street_names = EXCLUDED.street_names,
        normalized_streets = EXCLUDED.normalized_streets,
        type = EXCLUDED.type,
        detection = EXCLUDED.detection,
        vehicle_actuated = EXCLUDED.vehicle_actuated,
        pedestrian_signal = EXCLUDED.pedestrian_signal,
        pedestrian_actuated = EXCLUDED.pedestrian_actuated,
        accessible_pedestrian_signal = EXCLUDED.accessible_pedestrian_signal,
        transit_priority = EXCLUDED.transit_priority,
        emergency_preemption = EXCLUDED.emergency_preemption,
        red_light_camera = EXCLUDED.red_light_camera,
        geometry = EXCLUDED.geometry,
        inventory_as_of = EXCLUDED.inventory_as_of,
        data_loaded_at = EXCLUDED.data_loaded_at,
        inventory_snapshot_id = EXCLUDED.inventory_snapshot_id,
        raw_properties = EXCLUDED.raw_properties,
        active = true,
        last_seen_at = now()
    `, [JSON.stringify(records), snapshotId]);
  }
}

async function loadStreets(client: PoolClient, prepared: PreparedData, snapshotId: number): Promise<void> {
  for (const batch of chunks(prepared.streets, 300)) {
    const records = batch.map((row) => ({
      cnn: row.cnn,
      street_name: row.streetName,
      normalized_street_name: row.normalizedStreetName,
      from_street: row.fromStreet,
      to_street: row.toStreet,
      from_node_cnn: row.fromNodeCnn,
      to_node_cnn: row.toNodeCnn,
      class_code: row.classCode,
      active: row.active,
      layer: row.layer,
      geometry: row.geometry,
      source_as_of: iso(row.sourceAsOf),
      data_loaded_at: iso(row.dataLoadedAt),
      raw_properties: row.rawProperties,
    }));
    await client.query(`
      INSERT INTO street_segments (
        cnn, street_name, normalized_street_name, from_street, to_street,
        from_node_cnn, to_node_cnn, class_code, active, layer, geometry,
        source_as_of, data_loaded_at, source_snapshot_id, raw_properties, last_seen_at
      )
      SELECT
        x.cnn, x.street_name, x.normalized_street_name, x.from_street, x.to_street,
        x.from_node_cnn, x.to_node_cnn, x.class_code, x.active, x.layer,
        ST_SetSRID(ST_GeomFromGeoJSON(x.geometry::text), 4326),
        x.source_as_of, x.data_loaded_at, $2, x.raw_properties, now()
      FROM jsonb_to_recordset($1::jsonb) AS x(
        cnn text, street_name text, normalized_street_name text, from_street text,
        to_street text, from_node_cnn text, to_node_cnn text, class_code integer,
        active boolean, layer text, geometry jsonb, source_as_of timestamptz,
        data_loaded_at timestamptz, raw_properties jsonb
      )
      ON CONFLICT (cnn) DO UPDATE SET
        street_name = EXCLUDED.street_name,
        normalized_street_name = EXCLUDED.normalized_street_name,
        from_street = EXCLUDED.from_street,
        to_street = EXCLUDED.to_street,
        from_node_cnn = EXCLUDED.from_node_cnn,
        to_node_cnn = EXCLUDED.to_node_cnn,
        class_code = EXCLUDED.class_code,
        active = EXCLUDED.active,
        layer = EXCLUDED.layer,
        geometry = EXCLUDED.geometry,
        source_as_of = EXCLUDED.source_as_of,
        data_loaded_at = EXCLUDED.data_loaded_at,
        source_snapshot_id = EXCLUDED.source_snapshot_id,
        raw_properties = EXCLUDED.raw_properties,
        last_seen_at = now()
    `, [JSON.stringify(records), snapshotId]);
  }
}

async function loadDowntown(
  client: PoolClient,
  prepared: PreparedData,
  snapshotId: number,
  sourceAsOf: Date | null,
): Promise<void> {
  await client.query("DELETE FROM downtown_zoning_polygons");
  for (const batch of chunks(prepared.downtownPolygons, 200)) {
    const records = batch.map((row) => ({
      object_id: row.objectId,
      zoning_code: row.zoningCode,
      district_name: row.districtName,
      source_last_edited_at: iso(row.sourceLastEditedAt),
      geometry: row.geometry,
      raw_properties: row.rawProperties,
    }));
    await client.query(`
      INSERT INTO downtown_zoning_polygons (
        object_id, zoning_code, district_name, source_last_edited_at, geometry,
        source_snapshot_id, raw_properties
      )
      SELECT
        x.object_id, x.zoning_code, x.district_name, x.source_last_edited_at,
        ST_Multi(ST_CollectionExtract(ST_MakeValid(
          ST_SetSRID(ST_GeomFromGeoJSON(x.geometry::text), 4326)
        ), 3)),
        $2, x.raw_properties
      FROM jsonb_to_recordset($1::jsonb) AS x(
        object_id bigint, zoning_code text, district_name text,
        source_last_edited_at timestamptz, geometry jsonb, raw_properties jsonb
      )
    `, [JSON.stringify(records), snapshotId]);
  }
  await client.query(`
    INSERT INTO downtown_areas (
      id, definition, zoning_codes, geometry, source_snapshot_id, source_as_of, generated_at
    )
    SELECT
      'sf_c3_union',
      'Union of all official SF Planning layer 3 polygons whose zoning_sim begins C-3',
      array_agg(DISTINCT zoning_code ORDER BY zoning_code),
      ST_Multi(ST_CollectionExtract(ST_UnaryUnion(ST_Collect(geometry)), 3)),
      $1, $2, now()
    FROM downtown_zoning_polygons
    ON CONFLICT (id) DO UPDATE SET
      definition = EXCLUDED.definition,
      zoning_codes = EXCLUDED.zoning_codes,
      geometry = EXCLUDED.geometry,
      source_snapshot_id = EXCLUDED.source_snapshot_id,
      source_as_of = EXCLUDED.source_as_of,
      generated_at = now()
  `, [snapshotId, iso(sourceAsOf)]);
  await client.query(`
    UPDATE intersections i
    SET downtown = EXISTS (
      SELECT 1 FROM downtown_areas a
      WHERE a.id = 'sf_c3_union' AND ST_Covers(a.geometry, i.geometry)
    )
  `);
}

async function loadOsm(
  client: PoolClient,
  prepared: PreparedData,
  snapshotId: number,
  osmAsOf: Date,
): Promise<void> {
  await client.query("DELETE FROM osm_signal_components");
  for (const batch of chunks(prepared.osmComponents)) {
    const records = batch.map(({ component, match }) => ({
      osmType: component.osmType,
      osmId: component.osmId,
      longitude: component.coordinates[0],
      latitude: component.coordinates[1],
      tags: component.tags,
      nearbyStreets: component.nearbyStreets,
      normalizedStreets: component.normalizedStreets,
      intersectionCnn: match.intersectionCnn,
      matchStatus: match.status,
      matchConfidence: match.confidence,
      matchMethod: match.method,
      distanceM: match.distanceM,
      streetOverlap: match.streetOverlap,
      matchScore: match.score,
      candidateMatches: match.candidates,
    }));
    await client.query(`
      INSERT INTO osm_signal_components (
        osm_type, osm_id, geometry, tags, nearby_streets, normalized_streets,
        intersection_cnn, match_status, match_confidence, match_method, distance_m,
        street_overlap, match_score, candidate_matches, osm_as_of,
        source_snapshot_id, last_seen_at
      )
      SELECT
        x.osm_type, x.osm_id, ST_SetSRID(ST_MakePoint(x.longitude, x.latitude), 4326),
        x.tags, x.nearby_streets, x.normalized_streets, x.intersection_cnn,
        x.match_status, x.match_confidence, x.match_method, x.distance_m,
        x.street_overlap, x.match_score, x.candidate_matches, $2, $3, now()
      FROM jsonb_to_recordset($1::jsonb) AS x(
        osm_type text, osm_id bigint, longitude double precision, latitude double precision,
        tags jsonb, nearby_streets text[], normalized_streets text[], intersection_cnn text,
        match_status text, match_confidence text, match_method text, distance_m double precision,
        street_overlap integer, match_score double precision, candidate_matches jsonb
      )
    `, [JSON.stringify(records), osmAsOf.toISOString(), snapshotId]);
  }
}

export interface LoadCounts {
  intersections: number;
  streets: number;
  downtownPolygons: number;
  osmComponents: number;
  matchedOsmComponents: number;
  ambiguousOsmComponents: number;
  unmatchedOsmComponents: number;
}

export async function loadPreparedData(
  pool: Pool,
  sources: LoadedSources,
  prepared: PreparedData,
): Promise<LoadCounts> {
  const requestedSources = Object.values(sources).map((source) => source.sourceKey);
  const run = await pool.query<{ id: string }>(
    "INSERT INTO ingest_runs (requested_sources) VALUES ($1) RETURNING id",
    [requestedSources],
  );
  const runId = Number(run.rows[0].id);
  const client = await pool.connect();
  const counts: LoadCounts = {
    intersections: prepared.intersections.length,
    streets: prepared.streets.length,
    downtownPolygons: prepared.downtownPolygons.length,
    osmComponents: prepared.osmComponents.length,
    matchedOsmComponents: prepared.osmComponents.filter(({ match }) => match.status === "matched").length,
    ambiguousOsmComponents: prepared.osmComponents.filter(({ match }) => match.status === "ambiguous").length,
    unmatchedOsmComponents: prepared.osmComponents.filter(({ match }) => match.status === "unmatched").length,
  };
  try {
    await client.query("BEGIN");
    const [signalSnapshotId, streetSnapshotId, downtownSnapshotId, osmSnapshotId] = await Promise.all([
      recordSnapshot(client, sources.signals),
      recordSnapshot(client, sources.streets),
      recordSnapshot(client, sources.downtown),
      recordSnapshot(client, sources.osm),
    ]);
    await loadIntersections(client, prepared, signalSnapshotId);
    await loadStreets(client, prepared, streetSnapshotId);
    await loadDowntown(client, prepared, downtownSnapshotId, sources.downtown.sourceUpdatedAt);
    await loadOsm(
      client,
      prepared,
      osmSnapshotId,
      sources.osm.sourceUpdatedAt ?? sources.osm.fetchedAt,
    );
    await client.query("COMMIT");
    await pool.query(
      "UPDATE ingest_runs SET status='succeeded', completed_at=now(), counts=$2::jsonb WHERE id=$1",
      [runId, JSON.stringify(counts)],
    );
    return counts;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    await pool.query(
      "UPDATE ingest_runs SET status='failed', completed_at=now(), error=$2 WHERE id=$1",
      [runId, error instanceof Error ? error.stack ?? error.message : String(error)],
    ).catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
