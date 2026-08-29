# Deployment

## Local PostgreSQL and Next.js

Install Node.js 22+ and Docker, then create `.env.local` from `.env.example`.
Keep secret values out of Git.

```bash
docker compose up -d db
npm install
npm run db:migrate
npm run data:ingest
npm run dev
```

The Compose database listens on `localhost:5432` with the development credentials
shown in `docker-compose.yml`. Ingestion needs outbound access to the configured
public sources and may take several minutes. The website can continue serving
the last completed snapshot if a later ingestion run fails.

Useful checks:

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

## Environment variables

| Variable | Scope | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | server/CI | PostgreSQL connection string; production database must have PostGIS. |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | browser | Public Mapbox token restricted to deployed origins. |
| `DATASF_APP_TOKEN` | ingestion | Optional Socrata application token for rate limits. |
| `OVERPASS_ENDPOINT` | ingestion | Overpass interpreter used only by scheduled ingestion. |
| `INGEST_SECRET` | optional server | Reserved for a protected ingestion route; none is publicly exposed. |

Use a pooled managed-database URL for Vercel functions if the provider offers
one. If TLS is required, encode the provider's supported `sslmode` in the URL.
Grant the web deployment only `CONNECT`, schema `USAGE`, and `SELECT` where
practical; run migrations/ingestion with a separate write-capable CI role.

## Vercel

1. Create a PostgreSQL database with PostGIS and run `npm run db:migrate` from a
   trusted workstation or the GitHub workflow.
2. Import the repository into Vercel as a Next.js project.
3. Set `DATABASE_URL` and `NEXT_PUBLIC_MAPBOX_TOKEN` for Production and Preview.
   Use a different database for previews, or omit ingestion there.
4. Deploy. `vercel.json` pins functions near San Francisco and gives API routes a
   bounded execution window.
5. Verify `/api/v1/sources`, then `/api/v1/signals?limit=1`; confirm that the
   reported snapshot dates match the ingestion run.

Do not run long-lived ingestion as a Vercel page request. The included
`.github/workflows/refresh-data.yml` performs migrations and ingestion weekly or
on manual dispatch. Add repository secret `DATABASE_URL`; optionally add
`DATASF_APP_TOKEN`. GitHub's environment protection rules are recommended for a
production write credential.

## Recovery and rollback

Migrations are forward-only and recorded in `schema_migrations`. Ingestion uses
snapshots and run records; diagnose a failed run in `ingest_runs` and leave the
last successful normalized data serving. Before a schema migration, take a
provider snapshot. Application rollback is a normal Vercel deployment rollback;
do not delete source snapshots to make the UI appear older.

