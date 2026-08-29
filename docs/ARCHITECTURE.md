# Architecture

## System boundary

Glossa separates acquisition from serving. Scheduled ingestion contacts public
sources, validates and archives responses, and writes a new database snapshot.
Map visitors only call read-only Next.js handlers backed by PostgreSQL/PostGIS;
visitor requests never contact DataSF, SF Planning, or Overpass.

```text
DataSF / SF Planning / Overpass / timing files
                     |
              scheduled ingestion
                     |
        snapshots + normalized PostGIS tables
                     |
              signal_catalog view
                     |
              Next.js /api/v1
                     |
              map and downloads
```

## Data layers

`intersections` is the authoritative analytical unit: one active SFMTA
intersection per CNN. `osm_signal_components` stores individual mapped signal
heads and crossings separately, including unmatched and ambiguous records.
`timing_estimates` stores only evidence with provenance. The `signal_catalog`
view chooses one timing record using a deterministic evidence ranking and joins
the count of confidently matched OSM components.

Every fetched object is represented by `source_snapshots`, which records the
fetch time, upstream update time where available, checksum, byte and row counts,
and archive path. Normalized records retain their snapshot foreign key. An
ingestion failure does not erase the last successful snapshot.

## Request path

The API parses query strings with Zod and rejects unknown, repeated, malformed,
or out-of-range values. Filter values and identifiers are PostgreSQL parameters;
the only dynamic SQL identifiers come from a fixed in-code capability allowlist.
Bbox filtering uses the PostGIS GiST-indexed geometry. List results sort by the
stable `signal_catalog.id` and encode the last ID into a versioned opaque cursor.

Responses include source `asOf` values, attribution, bounded cache headers, and
an API generation time. Errors share one JSON envelope. CSV exports neutralize
spreadsheet formula prefixes and use RFC 4180 quoting. Exports stop at 50,000
rows and ask the caller to narrow filters instead of silently truncating.

## Runtime and operations

The web runtime uses a small, process-reused `pg` pool. Database queries have
connection, statement, and client query timeouts. API handlers run on the Node.js
runtime because `pg` is not an Edge-runtime client. Vercel serves the Next.js
application; a weekly/manual GitHub Actions workflow runs migrations and
ingestion away from visitor traffic.

Production credentials are server-only environment variables. The only browser
credential is a URL-restricted `NEXT_PUBLIC_MAPBOX_TOKEN`. The API is read-only;
the repository intentionally exposes no public ingestion endpoint.

