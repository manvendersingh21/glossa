# API v1

All endpoints are `GET`-only except the route estimate, which is `POST` (see
[Route estimate](#route-estimate)). Successful JSON responses are cached briefly at
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

## Route estimate

`POST /api/v1/route/estimate` accepts:

```json
{
  "origin": { "address": "1 Market St, San Francisco" },
  "destination": { "latitude": 37.789, "longitude": -122.401 },
  "departureTime": "2026-08-29T12:00:00-07:00"
}
```

Each point accepts either an `address` or a `latitude`/`longitude` pair.
`departureTime` is an optional offset ISO 8601 timestamp; when omitted the
estimate uses "leave in ~one minute." This endpoint requires a server-side
`GOOGLE_MAPS_API_KEY` and a configured `DATABASE_URL`; without the key it returns
`503 route_unavailable`, without the database `503 database_unavailable`.

The server evaluates several nearby departure candidates (one Google Routes
call each, capped — see Cost control) and returns the chosen candidate's route
plus a recommendation. `route`/`signals`/`estimate`/`departureTime` describe the
**recommended** candidate; `recommendation` ranks all scored candidates.

| Field | Meaning |
| --- | --- |
| `route` | Recommended candidate: `distanceMeters`, traffic-aware `durationSeconds`, free-flow `staticDurationSeconds`, `delaySeconds`, `encodedPolyline`. |
| `signals` | Signalized intersections matched to the route, with `timingKind`, `cycleSeconds`, `cycleRangeSeconds`, `confidence`, capability flags, `arrivalSeconds`, and `sourceAsOf`. |
| `estimate.likelySignalStops` / `likelySignalDelaySeconds` | Modeled stop/delay range for the recommended candidate. |
| `estimate.expectedSignalStops` / `expectedSignalDelaySeconds` | Point estimates. |
| `estimate.confidence` | `high` only with current/observed evidence and no unknowns; any stale/unknown signal forces `low`. |
| `estimate.explanation` / `estimate.rationale` | Human narrative + the signal model's structured rationale. |
| `estimate.modeledSignals` / `unknownSignals` | How many signals had usable cycle evidence vs none. |
| `recommendation.recommendedDepartureTime` | The lowest-expected-delay candidate. |
| `recommendation.scoreSeconds` / `scoreRangeSeconds` | Expected and bounded total delay (traffic + modeled signal delay). |
| `recommendation.trafficDelaySeconds` / `signalDelaySeconds` / `likelySignalStops` | Delay/stops breakdown at the recommended time. |
| `recommendation.confidence` / `explanation` | Same honesty floor as `estimate.confidence`, with the comparison narrative. |
| `recommendation.rankedAlternatives` | Other scored departures (`departureTime`, `scoreSeconds`, `scoreRangeSeconds`, `trafficDelaySeconds`, `signalDelaySeconds`, `likelySignalStops`, `recommended`), best-first. |
| `recommendation.candidatesConsidered` | How many candidates were scored successfully. |
| `departureTime` | The recommended departure instant (backwards-compatible). |

**Signal stops and delay are modeled from public timing evidence, signal-inventory
capability, and traffic-aware travel time — not a live red/green phase feed, which
does not exist for San Francisco in this project.** See [Methodology](METHODOLOGY.md)
and the [SFMTA timing research](SFMTA_TIMING_RESEARCH.md).

### Cost control

Each request makes at most `GLOSSA_MAX_DEPARTURE_CANDIDATES` Google Routes calls
(default `3`, clamped `1`–`5`) over `GLOSSA_DEPARTURE_WINDOW_MINUTES` (default `30`)
at `GLOSSA_DEPARTURE_INTERVAL_MINUTES` (default `15`). A failed non-primary
candidate is skipped, so one bad slot never fails the whole request. Set
`GLOSSA_MAX_DEPARTURE_CANDIDATES=1` for exactly one Google call (no alternatives).
The web UI consumes the server `recommendation` from a single request; it does NOT
re-issue one request per candidate.

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

