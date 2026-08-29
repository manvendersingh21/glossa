# Data dictionary

## Signal GeoJSON

Every `/signals` feature has Point geometry in WGS84 longitude/latitude.

| Field | Type | Meaning |
| --- | --- | --- |
| `id`, `properties.id` | string | Stable API ID; currently the inventory CNN. |
| `cnn` | string | DataSF centerline network node/intersection identifier. |
| `signalNumber` | string/null | Agency inventory signal number when published. |
| `name` | string | Inventory intersection name. |
| `downtown` | boolean | Point intersects the stored SF Planning C-3 union. |
| `type`, `detection` | string/null | Source inventory classifications without reinterpretation. |
| `vehicleActuated` | boolean/null | Vehicle actuation attribute in the inventory. |
| `pedestrianSignal` | boolean/null | Pedestrian-signal attribute in the inventory. |
| `pedestrianActuated` | boolean/null | Pedestrian actuation attribute in the inventory. |
| `accessiblePedestrianSignal` | boolean/null | Accessible pedestrian signal attribute. |
| `transitPriority` | boolean/null | Transit-priority attribute in the inventory. |
| `emergencyPreemption` | boolean/null | Emergency-preemption attribute in the inventory. |
| `redLightCamera` | boolean/null | Red-light-camera attribute in the inventory. |
| `osmComponentCount` | integer | Confidently matched OSM signal components; not intersection count. |
| `inventoryAsOf` | datetime/null | Effective upstream time, falling back to snapshot fetch time. |
| `osmAsOf` | datetime/null | Newest matched OSM component snapshot time. |

Null capability values are unknown/unpublished; they are not false.

## `timing`

| Field | Type | Meaning |
| --- | --- | --- |
| `kind` | enum | `current_official`, `stale_official`, `observed`, `modeled`, or `unknown`. |
| `cycleSeconds` | number/null | Nominal full-cycle seconds in the selected evidence. |
| `cycleRangeSeconds` | `[number,number]`/null | Minimum and maximum full-cycle seconds. |
| `cyclesPerHourRange` | `[number,number]`/null | Derived as `[3600/max,3600/min]`, or a repeated nominal rate, rounded to one decimal. |
| `confidence` | enum | `high`, `medium`, `low`, or `unknown`. |
| `modelVersion` | string/null | Required for modeled timing. |
| `rationale` | string[] | Evidence selection, assumptions, or explanation of unknown status. |
| `sourceUrl` | string/null | Timing evidence reference, not the inventory URL by implication. |
| `sourceAsOf` | datetime/null | Effective date of the selected timing evidence. |

Timing is dated evidence, never a representation of live controller state.

## Collection metadata

`count` is the number of features in this page, `nextCursor` is an opaque cursor
or null, `generatedAt` is response assembly time, `sources` gives upstream name,
URL, and latest stored as-of date, and `attribution` provides reuse notices.

## Area statistics

| Field | Unit | Meaning |
| --- | --- | --- |
| `area` | enum | `sf` or analytical `downtown`. |
| `signalCount` | intersections | Active authoritative inventory records. |
| `areaSquareMiles` | mi² | Census constant for SF; geodesic C-3 union area for downtown. |
| `roadMiles` | centerline mi | Active DataSF centerlines, clipped for downtown. |
| `signalsPerSquareMile` | intersections/mi² | Count divided by area. |
| `signalsPerRoadMile` | intersections/mi | Count divided by centerline miles. |
| `medianNearestSignalFeet` | feet/null | Median of each signal's nearest selected neighbor. |
| `timingCoveragePercent` | percent | Any non-unknown timing evidence. |
| `officialTimingPercent` | percent | Current plus stale official timing evidence. |
| `modeledTimingPercent` | percent | Modeled timing evidence. |

## CSV mapping

CSV uses snake_case equivalents of the feature fields. Point coordinates become
`longitude` and `latitude`; cycle range becomes `cycle_min_seconds` and
`cycle_max_seconds`; rationale strings are joined with ` | `. Empty cells encode
null. Potential spreadsheet-formula prefixes are escaped with a leading apostrophe.

## Core database tables

| Relation | Purpose |
| --- | --- |
| `source_definitions` | Source URLs, license/attribution, expected refresh, capabilities, limitations. |
| `source_snapshots` | Immutable fetch metadata, checksum, counts, and archive reference. |
| `ingest_runs` | Run status and per-source counts/errors. |
| `intersections` | Authoritative normalized signal intersections keyed by CNN. |
| `osm_signal_components` | OSM elements and auditable match status/candidates. |
| `timing_estimates` | Dated official, observed, or modeled cycle evidence. |
| `downtown_zoning_polygons`, `downtown_areas` | Versioned C-3 polygons and union. |
| `street_segments` | Versioned DataSF active/retired centerlines. |
| `signal_catalog` | Read-only flattened API view with selected timing evidence. |
