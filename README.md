# Glossa

Glossa is a reproducible explorer for San Francisco traffic-signal inventory,
equipment attributes, OpenStreetMap signal-component context, and explicitly
labeled cycle-timing evidence. It is a research tool, not a live traffic-control
feed: the public SFMTA inventory does not publish controller state, phase timing,
or cycle length, so the application never presents those fields as live facts.

## What is in the repository

- A Next.js map and read-only `/api/v1` interface.
- PostgreSQL/PostGIS migrations and snapshot-based ingestion.
- A conservative distinction between authoritative intersections (DataSF/CNN)
  and individual OSM signal components.
- Timing records labeled `current_official`, `stale_official`, `observed`,
  `modeled`, or `unknown`, with evidence dates and rationale.
- Reproducible San Francisco and downtown-C-3 summary statistics.

Start with [Architecture](docs/ARCHITECTURE.md),
[Methodology](docs/METHODOLOGY.md), and the [Data dictionary](docs/DATA_DICTIONARY.md).
The [API reference](docs/API.md) describes filters, pagination, exports, and
errors. Operational instructions are in [Deployment](docs/DEPLOYMENT.md).

## Local quick start

Prerequisites are Node.js 22+, Docker, and a URL-restricted Mapbox public token.
## 🧪 Quick Test & Mock Example Trip

Glossa's timing models and signal inventories are highest in density within the downtown core.

To run a mock analysis or test a trip query:
1. Open [http://localhost:3000](http://localhost:3000) after completing the local quick start.
2. Select an origin and destination **entirely within Downtown San Francisco** (e.g., *Market & 4th St → Ferry Building / Embarcadero*).
3. Observe how Glossa maps the C-3 district signal inventory, breaks down signal equipment attributes, and labels timing evidence confidence along the downtown corridor.

```bash
cp .env.example .env.local
docker compose up -d db
npm install
npm run db:migrate
npm run data:ingest
npm run dev
```

Open `http://localhost:3000`. `DATABASE_URL` must point to PostgreSQL with
PostGIS. `NEXT_PUBLIC_MAPBOX_TOKEN` is intentionally public and should be URL
restricted; database and ingestion credentials must never use `NEXT_PUBLIC_`.

Before contributing, run:

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

## Data and attribution

The primary intersection inventory comes from SFMTA through DataSF. Street
centerlines come from DataSF, the downtown definition comes from the official SF
Planning C-3 zoning layer, and OSM context is attributed to OpenStreetMap
contributors under ODbL. `/api/v1/sources` reports the latest successfully
stored snapshot and source limitations. A response generation timestamp is not
a source observation timestamp.

For timing records not already public, use the editable
[SFMTA public-records request template](docs/SFMTA_PUBLIC_RECORDS_REQUEST.md).

