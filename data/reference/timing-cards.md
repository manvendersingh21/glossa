# Timing-card import format

Copy `timing-cards.template.csv`, remove the example rows, and keep the header. Validate without a database:

```sh
npm run data:timings -- path/to/cards.csv --validate-only
```

`evidence_kind` is one of `official`, `observed`, or `modeled`. Do not label an estimate as official. Official rows require `stale_after`; the database view derives `current_official` versus `stale_official` from that date. Modeled rows require a `model_version`. Unknown is not imported as evidence: it is generated when an intersection has no timing evidence.

Provide either `cycle_nominal_seconds`, a `cycle_min_seconds`/`cycle_max_seconds` pair, or both. If both are present, nominal must fall inside the range. Separate multiple rationale statements with `|`. `source_url`, `source_as_of`, and a stable `import_key` are required. Reusing an import key intentionally updates that evidence record.

The importer archives the original CSV under the same bounded raw-snapshot retention policy as network sources and records its SHA-256 digest in `source_snapshots`.
