# API v1

All endpoints are `GET`-only. Successful JSON responses are cached briefly at
the CDN; errors use `Cache-Control: no-store`. Dates are ISO 8601 strings where a
source publishes them. `generatedAt` is when the response was assembled and
must not be interpreted as data freshness.

## Signals

`GET /api/v1/signals` returns a GeoJSON `FeatureCollection` with source metadata,
attribution, and cursor pagination.

| Parameter | Values | Default |
| --- | --- | --- |
| `bbox` | `west,south,east,north`; valid lon/lat, non-crossing | none |
| `downtown` | `true` or `false` | none |
| `timingKind` | `current_official`, `stale_official`, `observed`, `modeled`, `unknown` | none |
| `capability` | `vehicleActuated`, `pedestrianSignal`, `pedestrianActuated`, `accessiblePedestrianSignal`, `transitPriority`, `emergencyPreemption`, `redLightCamera` | none |
| `limit` | integer 1–2,000 | 500 |
| `cursor` | opaque `nextCursor` from the previous response | none |

Example:

```text
/api/v1/signals?bbox=-122.42,37.77,-122.39,37.80&timingKind=unknown&limit=250
```

`GET /api/v1/signals/{id}` returns one GeoJSON feature or a `404` error. The ID is
the inventory CNN in the current schema; clients should treat it as an opaque
string.

## Statistics and sources

`GET /api/v1/stats?area=sf|downtown` returns the metrics defined in
[Methodology](METHODOLOGY.md). `area` defaults to `sf`.

`GET /api/v1/sources` lists source definitions, attribution/license information,
capabilities and limitations, and the newest stored snapshot dates and row
counts. `meta.liveData` is always `false`.

## Export

`GET /api/v1/export?format=geojson|csv` accepts `bbox`, `downtown`, `timingKind`,
and `capability` with the same semantics as `/signals`. Format defaults to
`geojson`. Exports are deterministic by ID and capped at 50,000 rows. A larger
result returns `413 export_too_large`; narrow it with a bbox or another filter.
CSV field names and meanings are in the [Data dictionary](DATA_DICTIONARY.md).

## Errors

Errors consistently use this shape:

```json
{
  "error": {
    "code": "invalid_query",
    "message": "One or more query parameters are invalid.",
    "details": [{ "field": "bbox", "message": "..." }]
  },
  "meta": { "generatedAt": "2026-08-29T12:00:00.000Z" }
}
```

Expected codes include `invalid_query`, `invalid_cursor`, `invalid_path`,
`not_found`, `export_too_large`, `data_unavailable`, `database_unavailable`, and
`internal_error`. Error details never contain SQL or credentials.

