# Hackathon Demo — Signal-Aware Routing (Honest Guide)

> Glossa is a research and exploration tool for San Francisco traffic-signal data, with a
> signal-aware routing preview. This document is the evidence-based demo guide and
> validation report. It is written to match the **integrated** behavior of
> `POST /api/v1/route/estimate` (the build on `main`), not the earlier naive estimator that
> still lives on some devbox branches.
>
> **One-line honesty contract.** Glossa estimates *when to leave*, an *arrival time*, and a
> *range of likely signal stops and delay* — and it labels confidence and limits. It **never
> claims a live red/green phase feed**, because **no such feed is published for San Francisco
> in this project.** Realistic routes return **`confidence: "low"` by design.**

---

## 1. Honest headline (read this first)

- **No live red/green feed exists.** The DataSF Traffic Signals inventory publishes
  equipment and capability metadata but **no** cycle length, phase timing, offset, or live
  controller state (its `source_definitions` capability flags are `cycle_timing:false`,
  `phase_timing:false`, `live_state:false`). Glossa therefore never prints a per-signal
  "green now" claim. What it shows instead is a **modeled** range built from dated evidence,
  clearly labeled.
- **Realistic SF routes are low-confidence by design.** Confidence is `high` only with
  full `current_official`/`observed` evidence at every signal on the route (and no unknowns);
  `medium` only if every signal has at least a `stale_official` record (and no unknowns);
  `low` whenever any signal is `unknown`. Real corridors are dominated by `unknown` signals,
  so every realistic route reads **`low`**.
- **The one imported SF card is stale and its cycle is unverified.** The only timing row in
  the repo is 5th St & Mission St (CNN `24634000`), imported as official evidence with a 90 s
  cycle and 71 s offset, `source_as_of = 2022-10-20`, `stale_after = 2023-10-20`. It is
  `stale_official` by date **and** its 90 s cycle is **not supported by the source PDF**, so
  the integrated build **reclassifies** it rather than crediting it. Net effect: there is
  effectively **zero** credible current timing anywhere in the city today, and the route
  estimate refuses to pretend otherwise.
- **What *is* live.** Road traffic, route geometry, and the traffic-aware ETA come from the
  Google Routes API at request time — the single genuinely live piece of the response, only
  when `GOOGLE_MAPS_API_KEY` is set server-side.

Sections 4 (live/modeled/historical/unknown), 5–7 (how the estimate and recommendation work),
and 11 (why SFMTA rules make this different) ground each of these claims.

---

## 2. Scope of this document and how it was produced

- **Own file only.** This is the only artifact this work touches: `docs/HACKATHON_DEMO.md`.
  No source code, migrations, or other docs were modified.
- **Documented to the integrated build.** The devbox working tree this was authored on
  carries an earlier naive route estimator and does not expose the live integrated endpoint,
  the recommendation object, or the new confidence ladder. The behavior below is therefore
  specified from the integrated contract (origin → destination → route + signals + estimate +
  recommendation) rather than re-derived from a live call in this environment.
- **What could be verified on-tree.** The underlying deterministic libraries the integrated
  endpoint is built from — `lib/server/signal-model.ts` (per-signal delay model) and
  `lib/server/departure-recommendation.ts` (departure optimizer) — are present and unit-tested
  here. Their output field names (`expectedSignalStops`, `expectedDelaySeconds`,
  `modeledSignals`, `unknownSignals`; `scoreSeconds`, `scoreRangeSeconds`) match the fields the
  integrated response returns, so the modeled numbers in §3 are derived from those libraries'
  documented math for the all-`unknown` case (the only case realistic routes present).
  `npm test` is run at the end as a **non-regression** check; it does not exercise the new
  endpoint wiring and must not be cited as proof of the integrated behavior.
- **What was not done.** No live ETA, route distance, traffic delay, or on-corridor matched
  signal count was measured (no Google key, no Postgres/PostGIS in this environment). Those
  columns in §3 are explicitly marked "live run required" or "assumed (pending live DB query)"
  rather than invented.

---

## 3. The five realistic San Francisco routes

All five are real corridors SFMTA's own Vision Zero retiming / TSP / TASC material names as
signalized corridors (see `docs/SFMTA_TIMING_RESEARCH.md`, P1 corridor list).

Column definitions:

- **Ref. length** — a planning estimate of corridor length, *not* `route.distanceMeters`
  (which only the live Google call returns).
- **Matched signals `n` (assumed)** — a plausible midpoint of the corridor's signalized-
  intersection count, **pending a live `ST_DWithin(…, 35 m)` query** against `signal_catalog`.
  Flagged as an assumption because it could not be measured here.
- **Estimate (integrated model, all-`unknown`)** — the deterministic output of the
  signal-delay model when every matched signal is `unknown`: `likelySignalStops = [0, n]`,
  `likelySignalDelaySeconds = [0, 60·n]`, `expectedSignalStops ≈ 0.5·n`,
  `expectedDelaySeconds ≈ 22.5·n`, `modeledSignals = 0`, `unknownSignals = n`. (For an
  unknown signal the model adds 0.5 expected stops / 22.5 s expected delay, with a `[0, 60 s]`
  range band; `likely` = `[floor(lower), ceil(upper)]`.) This is the only signal model that
  realistic routes trigger, because no credible current timing exists.
- **Confidence** — `low` on all five, by design (any unknown signal ⇒ low).
- ** Recommendation ** — the optimizer's behavior on that route (see §5–6).
- **Live ETA / delay** — Google-only; marked "live run required."

| # | Route (origin → destination) | Ref. length | `n` (assumed) | Estimate (likely stops / likely delay; expected stops / expected delay; modeled/unknown) | Confidence | Recommendation behavior | Timing evidence on route | Observed behavior |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Embarcadero & Townsend → King St & 4th St (Mission Bay / Oracle Park) | ~1.2 mi | 8 (plausible 7–9) | stops **0–8** · delay **0–480 s** · expStops 4.0 · expDelay 180.0 s · modeled 0 / unknown 8 | **low** | Scores up to 3 candidates (default window 30 min / interval 15 min); signals are all unknown so the signal term is a flat wide band and ranking is driven by traffic differences across candidate departures. | None. All signals `unknown`. | `estimate.confidence = "low"`; `estimate.explanation` notes no usable timing evidence; `recommendation` still returns a best-leave-time driven by live traffic. |
| 2 | **5th St & Mission St → Civic Center (UN Plaza / 7th & Market)** | ~0.6 mi | 6 (plausible 5–7) | stops **0–6** · delay **0–360 s** · expStops 3.0 · expDelay 135.0 s · modeled 0 / unknown 6 | **low** | Same as above. The reclassified 5th/Mission card contributes no modeled signal. | **5th/Mission card sits on this route but is `stale_official` AND reclassified** because its 90 s cycle is unsupported by the source PDF → counts as `unknown` for routing. | The signal detail panel still *displays* the card (90/71, 2022) as historical context, but the route estimate stays `low` and treats it as non-credited. The honesty hero moment. |
| 3 | 16th St & Mission St → 24th St & Mission St (14-Mission TSP corridor) | ~0.5 mi | 9 (plausible 8–10) | stops **0–9** · delay **0–540 s** · expStops 4.5 · expDelay 202.5 s · modeled 0 / unknown 9 | **low** | Same. | None imported. SFMTA documents TSP here in prose, but no timing row is loaded. | TSP is a *capability* flag, never an override for missing timing; the route stays `low`. |
| 4 | Geary Blvd & 25th Ave → Geary Blvd & Park Presidio (38/38R TSP corridor) | ~1.1 mi | 11–14 (midpoint 12) | stops **0–12** · delay **0–720 s** · expStops 6.0 · expDelay 270.0 s · modeled 0 / unknown 12 | **low** | Same. Longer corridor ⇒ wider `[0, 60·n]` band (range scales with `n`, not with measured green splits). | None imported. | Same. |
| 5 | Cesar Chavez & Guerrero St → Valencia St & 19th St (ISCOTT-connected network) | ~0.8 mi | 6 (plausible 5–7) | stops **0–6** · delay **0–360 s** · expStops 3.0 · expDelay 135.0 s · modeled 0 / unknown 6 | **low** | Same. | ISCOTT card (CNN `21897000`, dials 111/212/313, 2020) is **downloaded locally but not imported** ⇒ `unknown` at serve time. | The strongest public fixture (3 plans, phase states) is invisible to routing because it was never loaded. |

> **Why the range is `[0, n]` / `[0, 60·n]`.** `signal-model.ts` treats an unknown signal
> conservatively: 0 to 1 likely stops and 0 to 60 s likely delay per signal, 0.5 expected
> stops and 22.5 s expected delay. With no admissible cycle/phase/offset, the model
> intentionally refuses to discriminate *which* signals will stop a given driver.
>
> **Sensitivity to `n`.** A live DB query returning `n ± 2` signals only shifts the upper
> bound (e.g. Route 4 at `n=11` → `0–11` / `0–660 s`; at `n=14` → `0–14` / `0–840 s`). The
> **confidence stays `low` in every case** (§7).
>
> **ETA is live-only.** `route.durationSeconds` (traffic-aware ETA),
> `route.staticDurationSeconds` (no-traffic baseline), and
> `route.delaySeconds = max(0, duration − static)` come **only** from the Google Routes call.
> They cannot be projected here without overclaiming and are left as "live run required."

---

## 4. What is Live / Modeled / Historical / Unknown

| Class | Meaning in Glossa | What it is in the demo | Source of truth |
| --- | --- | --- | --- |
| **Live** | An external datum observed at request time. | `route.durationSeconds`, `route.staticDurationSeconds`, `route.delaySeconds`, `route.distanceMeters`, `route.encodedPolyline` from the Google Routes API. **Only available when server-side `GOOGLE_MAPS_API_KEY` is set.** | Google Routes API call inside `estimateRoute` (`routes.googleapis.com/directions/v2:computeRoutes`, `routingPreference: "TRAFFIC_AWARE_OPTIMAL"`). |
| **Modeled** | A Glossa-computed estimate, never a controller reading. | `estimate.likelySignalStops`, `estimate.likelySignalDelaySeconds`, `estimate.expectedSignalStops`, `estimate.expectedDelaySeconds`, `estimate.modeledSignals`, `estimate.unknownSignals`, `estimate.confidence`, `estimate.explanation`; plus the `recommendation` block (best leave-time, scored alternatives). For the demo routes, all signals are `unknown`, so these are the conservative `[0, n]` / `[0, 60·n]` bands. | `lib/server/signal-model.ts` (`estimateSignalDelay`) and `lib/server/departure-recommendation.ts` (`recommendDeparture`), wired into the integrated route endpoint. |
| **Historical** | A dated, agency-origin record retained for context. | The 5th/Mission card: 90 s cycle, 71 s offset, `source_as_of = 2022-10-20`, `stale_after = 2023-10-20` → `stale_official`. Its 90 s cycle is **not supported by the source PDF**, so it is reclassified and not credited to routing. ISCOTT (2020) and 4th/Mission Bay testing cards are historical fixtures stored locally but **not imported**. | `data/reference/sfmta-public-timing-cards.csv`, `data/reference/sfmta-5th-mission-reviewed.json`, `db/migrations/001_data_foundation.sql` (`signal_catalog` freshness classification), `docs/SFMTA_TIMING_RESEARCH.md`. |
| **Unknown** | No admissible cycle/phase/offset evidence is stored. | The timing kind for essentially every other SF intersection. The DataSF inventory publishes capabilities but no timing. | `source_definitions` capabilities `cycle_timing:false, phase_timing:false, live_state:false`; `signal_catalog` view `COALESCE(t.timing_kind,'unknown')`. |

Per-route mapping:

- **Route 1 (Embarcadero/King):** live ETA (key pending) · modeled stops/delay/recommendation · historically nothing · all signals unknown.
- **Route 2 (5th/Mission → Civic Center):** live ETA (key pending) · modeled stops/delay/recommendation · **one historical stale+reclassified card on the route, not credited** · all signals unknown for routing.
- **Route 3 (16th → 24th & Mission):** live ETA (key pending) · modeled stops/delay/recommendation · historically none imported (TSP is described in SFMTA blog text only) · all signals unknown.
- **Route 4 (Geary/25th → Park Presidio):** live ETA (key pending) · modeled stops/delay/recommendation · historically none imported · all signals unknown.
- **Route 5 (Cesar Chavez/Guerrero → Valencia):** live ETA (key pending) · modeled stops/delay/recommendation · ISCOTT card historical on disk but **not imported** ⇒ unknown at serve time · all signals unknown.

---

## 5. How the integrated route estimate is computed

`POST /api/v1/route/estimate` accepts an `origin` and `destination` (each an `address`
string **or** a `{latitude, longitude}` pair) and an optional `departureTime` (ISO 8601
**with offset**, in the future). Response shape:

```jsonc
{
  "route":   { "distanceMeters", "durationSeconds", "staticDurationSeconds", "delaySeconds", "encodedPolyline" },
  "signals": [ { "cnn", "name", "coordinates", "distanceMeters", "routePosition",
                 "timingKind", "cycleSeconds", "cycleRangeSeconds", "confidence",
                 "vehicleActuated", "pedestrianActuated", "transitPriority" } ],
  "estimate": { "likelySignalStops", "likelySignalDelaySeconds",
                "expectedSignalStops", "expectedDelaySeconds",
                "confidence", "explanation", "modeledSignals", "unknownSignals" },
  "departureTime": "...",
  "recommendation": { "recommendedDepartureTime", "scoreSeconds", "scoreRangeSeconds",
                      "trafficDelaySeconds", "modeledSignalDelaySeconds",
                      "likelySignalStops", "confidence", "explanation",
                      "rankedAlternatives", "candidatesConsidered" }
}
```

Pipeline (integrated build):

1. **Return 503 if no key.** If `GOOGLE_MAPS_API_KEY` is missing or `replace_me`:
   `503 { code: "route_unavailable", message: "Google Maps routing is not configured." }` —
   Glossa never prints a fabricated ETA. *(This 503 contract is stable across the naive and
   integrated builds.)*
2. **Call Google Routes** (`TRAFFIC_AWARE_OPTIMAL`, `DRIVE`, `departureTime` defaulting to
   `now + 60 s` because Google requires a future departure). On an unusable/short polyline
   or an empty `routes[]` / non-2xx body, return `502 route_unavailable`.
3. **Match signals.** A single SQL query against `public.signal_catalog` finds every active
   inventory signal within **35 meters** of the decoded route geometry
   (`ST_DWithin(…::geography, …::geography, 35)`), ordered by `ST_LineLocatePoint` along the
   route (exposed per-signal as `routePosition`). **This step has no static/offline fallback**
   — it requires a live Postgres/PostGIS DB.
4. **Estimate (signal-model).** `estimateSignalDelay` evaluates each matched signal against
   its timing evidence (`timingKind`, `cycleSeconds`, `cycleRangeSeconds`, offset, green
   windows, actuation, transit priority). Outputs `likelySignalStops`,
   `likelySignalDelaySeconds`, `expectedSignalStops`, `expectedDelaySeconds`,
   `modeledSignals`, `unknownSignals`, `confidence`, `explanation`. For a fully-`unknown`
   route (every realistic route today) this is the conservative `[0, n]` / `[0, 60·n]` band
   at `confidence: "low"` (§7).
5. **Recommendation (departure optimizer).** `recommendDeparture` generates candidate
   departure times and scores each by `trafficDelay + mean(signalDelay)` (with a
   `[low, high]` score range). It returns `recommendedDepartureTime`, `scoreSeconds`,
   `scoreRangeSeconds`, the traffic and signal delay ranges, `likelySignalStops`,
   `confidence`, `explanation`, the `rankedAlternatives`, and `candidatesConsidered`. The
   **estimated arrival time** is `recommendedDepartureTime + (that candidate's
   durationSeconds)`. Candidate generation is bounded by the cost-control settings (§6).

---

## 6. Departure recommendation and cost control

The recommendation evaluates a small number of candidate departure times and recommends the
lowest expected-delay one. Cost is controlled by three environment variables:

| Variable | Default | Range / behavior | Meaning |
| --- | --- | --- | --- |
| `GLOSSA_MAX_DEPARTURE_CANDIDATES` | `3` | clamped to **1–5** | Maximum number of departure candidates to evaluate per request. |
| `GLOSSA_DEPARTURE_WINDOW_MINUTES` | `30` | positive minutes | Size of the lookahead window (from the requested/guessed departure). |
| `GLOSSA_DEPARTURE_INTERVAL_MINUTES` | `15` | positive minutes | Spacing between candidates. |

With defaults, the window is 30 minutes at a 15-minute interval → candidates at `+0`, `+15`,
`+30`, capped at 3. Each candidate requires its own traffic-aware Google call; to bound cost,
**failed non-primary candidates are skipped** (the request still succeeds with the remaining
candidates). Only a failure of the **primary** candidate (the requested departure, or "now"
if omitted) aborts the request.

> **Honest limitation on realistic routes.** When every signal is `unknown`, the signal-delay
> term is a flat `[0, 60·n]` band independent of departure time, so the recommendation's
> discrimination comes almost entirely from **traffic** differences across candidate departures.
> The signal term only becomes departure-sensitive (and the recommendation more
> discriminating) once current timing evidence is imported. Until then the recommendation is
> best read as "leave when traffic is lightest," with a wide, low-confidence signal band attached.

---

## 7. Confidence ladder and why realistic routes are `low`

The integrated `confidence` is set by `estimateSignalDelay`:

- **`high`** — only when **every** matched signal has `current_official` or `observed` evidence
  **with full per-movement detail** (cycle + offset + green windows / phase intervals) **and**
  no signal is `unknown`. In practice unreachable today: there is no such evidence citywide.
- **`medium`** — only when every matched signal has at least `stale_official` evidence
  **and** no signal is `unknown`.
- **`low`** — whenever **any** matched signal is `unknown` (or only `modeled`/unsupported
  evidence is present). This is the rule realistic routes hit, because SF corridors are
  dominated by `unknown` signals.

**Why the 5th/Mission card does not lift Route 2.** Two independent reasons:

1. **Any-unknown ⇒ low.** Route 2 contains other intersections besides 5th/Mission; those are
   `unknown`, so the route is `low` regardless of the one card.
2. **The card is reclassified.** Even setting (1) aside, the card is `stale_official` by date
   **and** its 90 s cycle is **not supported by the source PDF**, so the integrated build
   reclassifies it rather than crediting it. In short: there is **no** credible current
   timing anywhere on any realistic route, so all five routes are `low` by design.

This is the honesty posture an ordinary navigation app does not adopt: Glossa refuses to
promote a stale, unverified, 2022-era number into a confident 2026 prediction.

---

## 8. Prerequisites and bring-up

**Never print or commit `.env.local`.** It holds the server-side Google key and is
gitignored. Do not `cat`, `tail`, `echo`, or log it; do not stage it. The only credential
meant for the browser is the URL-restricted `NEXT_PUBLIC_MAPBOX_TOKEN`.

```bash
# 1. Secrets (edit by hand; never commit)
cp .env.example .env.local
#   GOOGLE_MAPS_API_KEY=<server-side key>      # REQUIRED for any route ETA
#   NEXT_PUBLIC_MAPBOX_TOKEN=<URL-restricted pk. token>  # optional, for the map UI
#   INGEST_ALLOW_EMPTY_OSM=true               # see step 4

# 2. Postgres + PostGIS (required for the signal match and the timing view)
docker compose up -d db

# 3. Install + migrate
npm install
npm run db:migrate

# 4. Ingest the inventory. Overpass is frequently flaky; allow an empty OSM result
#    so a transient Overpass outage does not abort the whole ingest.
INGEST_ALLOW_EMPTY_OSM=true npm run data:ingest

# 5. Import the one SFMTA timing card (5th/Mission). Without this, even the historical
#    card is unknown at serve time. (The scheduled refresh workflow does NOT run this.)
npm run data:timings -- data/reference/sfmta-public-timing-cards.csv

# 6. Sanity checks (non-regression)
npm run typecheck && npm run lint && npm test

# 7. Run
npm run dev   # http://localhost:3000
```

Cost-control knobs (optional, see §6): `GLOSSA_MAX_DEPARTURE_CANDIDATES`,
`GLOSSA_DEPARTURE_WINDOW_MINUTES`, `GLOSSA_DEPARTURE_INTERVAL_MINUTES`.

---

## 9. Smoke-test curl matrix

Run after `npm run dev` (replace `GOOGLE_MAPS_API_KEY` in `.env.local` with a real key).
`jq` optional for readability.

```bash
B=http://localhost:3000

# 0) App loads
curl -s -o /dev/null -w "GET /              -> %{http_code}\n" $B/

# 1) Provenance / freshness (NOT the same as generatedAt)
curl -s "$B/api/v1/sources" | jq '.sources[] | {name, asOf, limitations}'
#    expect meta.liveData === false; limitations list "no cycle/phase/live state".

# 2) One signal feature
curl -s "$B/api/v1/signals?limit=1" | jq '.features[0].properties | {name, timing: .timing.kind, cycleSeconds: .timing.cycleSeconds}'

# 3) Area statistics (default deploy: officialTimingPercent ~ 0)
curl -s "$B/api/v1/stats?area=sf" | jq '{signalCount, timingCoveragePercent, officialTimingPercent, modeledTimingPercent}'

# 4) Route estimate (the integrated endpoint) — addresses
curl -s -X POST "$B/api/v1/route/estimate" \
  -H 'content-type: application/json' \
  -d '{"origin":{"address":"5th St & Mission St, San Francisco"},
       "destination":{"address":"UN Plaza, San Francisco"}}' \
  | jq '{route: .route | {distanceMeters, durationSeconds, staticDurationSeconds, delaySeconds},
         estimate, departureTime, recommendation}'
#    expect estimate.confidence == "low"; estimate.unknownSignals == n; estimate.modeledSignals == 0;
#    recommendation with recommendedDepartureTime / scoreSeconds / scoreRangeSeconds / rankedAlternatives.
```

With no Google key, step 4 returns `503 {"error":{"code":"route_unavailable","message":"Google Maps routing is not configured."}}` — the guardrail, not a bug. With no DB, step 4 errors (route has no static fallback), while steps 1–3 fall back to the static export (every signal `unknown`, coverage 0%).

---

## 10. Recommended demo flow (three minutes)

Hero route is **Route 2** (5th & Mission → Civic Center): short, downtown, and it passes
the one intersection that carries (stale, reclassified) timing evidence — so the honesty story
lands in a single submit.

**Pre-flight (before the clock):** steps 1–7 of §8 done; browser open at `http://localhost:3000`,
area = Downtown. Have `docs/SFMTA_PUBLIC_RECORDS_REQUEST.md` open in a tab.

### 0:00–0:40 — Orientation & the honesty banner
*Click "All SF", then "Downtown".* "This is Glossa, a San Francisco signal atlas. The badge
up top says **Planning snapshot — not a live feed**; `generatedAt` is when the response was
assembled, not when the data was observed — real freshness is on `/api/v1/sources`. Look at
the stat cards: signal count and density are fine, but **Timing coverage** and **Published
timing** are the honest ones — in a default deploy they're **zero**, because the city doesn't
publish cycle or phase timing. That's the fact we built around."

### 0:40–1:20 — Evidence vs a nav-app guess
*Open the 5th & Mission signal.* "Even here the badge says **Official · archived** — cycle 90,
offset 71, source date **Oct 2022**. Glossa didn't hide that it's stale, and it adds *'Current
operation may differ.'* In fact that 90-second cycle isn't even supported by the source PDF, so
the integrated build **reclassifies** it rather than trusting it." *Toggle the Unknown filter
off — much of the map disappears; toggle it back.* "Those grey dots aren't missing data;
they're the city's honest answer: **we don't publish timing here.** No nav app tells you which
of its 'green wave' numbers come from a 2022 card and which it made up. Glossa does."

### 1:20–2:15 — The signal-aware route estimate (hero route)
*In the route planner: "5th St & Mission St" → "UN Plaza, San Francisco"; click +15 min;
"Estimate my trip".* "Four things come back. The **Traffic-aware ETA** tile is live —
straight from Google's Routes API at request time. The **Likely signal stops** and
**Estimated signal delay** tiles are **modeled** — note the caption, *'Modeled, not live
phase data.'* And there it is: **low confidence.** Even with a real card at the origin, the
route says low — because that card is stale, unverified, and *reclassified*, and the other
signals on the corridor are unknown. Glossa won't promote a 2022 plan to a 2026 promise."
*Point at the recommendation.* "It still **recommends when to leave**, scored across a few
candidate departure times — but read it honestly: with no real timing loaded, the signal band
is wide and flat, so this recommendation is really 'leave when traffic is lightest.'"

### 2:15–2:40 — Why it's different
"Every other app hands you one confident ETA and a green-wave score. Glossa splits that ETA
into a **live** piece it measured and a **modeled** piece it explicitly *didn't*, then tells
you the difference and the confidence. It cannot tell you whether 5th and Mission is green
right now — because **SFMTA doesn't publish that** — so it doesn't try."

### 2:40–3:00 — Close & the commitment
"When you want today's plans, there's a one-click path." *(Show the records-request tab.)*
"Plug in the five CNNs we just routed. The day SFMTA returns current controller exports, the
`low` labels tighten, `modeledSignals` rises, the recommendation's signal term becomes
departure-sensitive, and nothing else changes. Glossa gets better the day the data does — and
not a day sooner."

> **Contingency (if the ETA tile shows "Google Maps routing is not configured"):** that's the
> §5 step-1 / 503 guardrail — routing only runs with an explicit live key, so Glossa never
> prints a fabricated ETA. Drop to a two-beat variation: narrate §0:40–1:20's panel evidence
> plus the live/modeled/unknown framing of §4. The honesty message still fits three minutes.

---

## 11. Why SFMTA timing rules make Glossa different from ordinary navigation apps

Ordinary navigation apps fold traffic-signal delay into one confident, opaque ETA and never
say *why* a delay exists or whether the plan behind it is current. Glossa takes the opposite
position because of five facts about how SF actually runs its signals (all in
`docs/SFMTA_TIMING_RESEARCH.md`):

1. **No citywide, machine-readable, current timing feed.** Public material is sparse
   individual cards, TASC/project packets, engineering analyses, and inventory metadata.
   The DataSF inventory explicitly publishes no cycle/phase/offset/live state. A nav app's
   "green wave" is a guess from a source that does not exist; Glossa labels the absence
   `unknown`.
2. **Timing is plan-based and time-varying.** An intersection runs named dials/patterns by
   weekday and time window (ISCOTT alone has plans 111/212/313), each with its own cycle,
   offset, and phase sequence. A bare "100 s cycle" has no plan identity; Glossa retains plan,
   effective date, and weekday/window so an estimate is reproducible *under a named plan*.
3. **Coordination is directional and movement-specific.** Cycle + offset + a reference phase
   model progression *along a corridor*, favoring one direction or mode; a through phase may
   not serve a turn. Glossa's model treats route direction and movement as first-class (the
   `greenWindows` per movement in `signal-model.ts`).
4. **Static plans are routinely overridden.** Vehicle/pedestrian actuation extend or defer
   phases; transit signal priority (TSP, along Mission and Geary) holds/shortens greens;
   emergency preemption; adaptive/sensor pilots; construction, events, 4 AM clock resets,
   controller faults. A deterministic plan is a *baseline*, not a guarantee. Glossa surfaces
   these as explicit uncertainty bands and rationale lines.
5. **Freshness ≠ delivery date.** A card's effective/revision date decides currency, not its
   download date. Glossa stores `source_as_of`, `plan_date`, `stale_after`; `signal_catalog`
   classifies `current_official` vs `stale_official` deterministically from `stale_after`; and
   the route estimate withholds a confidence boost from stale/unverified evidence — including
   the reclassified 5th/Mission card.

**Net differentiator.** Glossa's route output is deliberately *less* certain than a nav app's,
and attributes every part: live ETA (Google) vs modeled stops/delay + recommendation (Glossa)
vs historical card (dated source) vs unknown (most of the city). The promise is not "hit every
green"; it is "never show a confident green the city has not actually published."

---

## 12. Failure cases

| # | Trigger | Symptom | Demo handling |
| --- | --- | --- | --- |
| 1 | No `GOOGLE_MAPS_API_KEY` (or `replace_me`) | `503 route_unavailable "Google Maps routing is not configured."` | The guardrail: routing only runs with a live key, so no fake ETA. Map/panels still work. |
| 2 | No reachable Postgres/PostGIS | Signals endpoints fall back to static export (all signals `unknown`, coverage 0%); **route estimate errors** (no static fallback). | Narrate the asymmetry: the map degrades honestly; routing cannot run offline. |
| 3 | `data:timings` never run | Every signal `unknown`, **even 5th/Mission**; stats 0% official. | Pre-flight runs it; otherwise say "default deploy shows 0% coverage." |
| 4 | Google returns an unusable polyline (<2 points) or empty `routes[]` | `502 route_unavailable` | Usually a non-driveable origin/destination; pick a real address. |
| 5 | `departureTime` without a timezone offset, or in the past | Zod rejects → `400` (server) / client "Departure time must be in the future." | Use the `+15 min` / `+30 min` quick buttons, which emit valid offset datetimes. |
| 6 | Cost-control set to 1 candidate, or window < interval | `recommendation` returns a single candidate; still valid, just not a comparison. | Acceptable; say "we can widen the window to compare leave-times." |
| 7 | A non-primary candidate's Google call fails | That candidate is **skipped**, request still succeeds with the rest. | Transparent; only a **primary** failure aborts. |
| 8 | 35 m buffer over/under-matches | Divided roads, mid-block ped heads, or junction-center offsets may be missed/added; a phase that serves *your* movement is never known from a Point alone. | Frame `signals.length` as "matched signalized intersections near the route," not "signals I will stop at." |
| 9 | Expecting a live red/green phase feed | None exists; `meta.liveData === false` on `/api/v1/sources`. | Never narrate "Glossa predicts when each light turns green." Say "estimates a range of likely stops/delay, labeled." |
| 10 | Overclaiming citywide coverage | Public corpus ≈ 3 unique sources; 5th/Mission and Mary/Mint packet are byte-identical duplicates; ISCOTT/4th-Mission-Bay not imported; 5th/Mission reclassified. | If asked "how much of SF is covered": "effectively zero current; one historical, unverified card." |
| 11 | Treating `generatedAt` as freshness | It's response assembly time; the snapshot badge warns it's a planning snapshot. | Point at the badge; cite `/api/v1/sources` for real upstream dates. |

---

## 13. Known limitations (what we do not claim)

- **No live red/green phase feed.** None is published for SF in this project; Glossa does not
  synthesize one. What it shows is a **modeled** range with explicit confidence.
- **Low confidence by design on realistic routes.** With `unknown` signals on every corridor,
  `confidence === "low"`, `likelySignalStops === [0, n]`, `likelySignalDelaySeconds === [0, 60·n]`.
  This is intended behavior, not a bug to fix without first acquiring current timing.
- **One stale, unverified, reclassified card.** 5th/Mission is `stale_official` (2022) **and**
  its 90 s cycle is not supported by the source PDF, so it is reclassified and not credited —
  realistic routes stay low even on Route 2 which passes it.
- **Recommendation is traffic-driven while timing is unknown.** On low-confidence routes the
  signal-delay term is a flat wide band; the recommendation primarily distinguishes leave-times
  by traffic. It becomes more discriminating only as current timing evidence is imported.
- **ETA / distance / matched counts not measured here.** No Google key and no Postgres/PostGIS
  in this environment; those columns are marked "live run required" / "assumed" in §3.
- **Overpass flakiness.** Ingest may yield an empty OSM component set; `INGEST_ALLOW_EMPTY_OSM=true`
  keeps the inventory ingest from aborting. OSM context (component counts) may then be zero;
  this does not affect routing, which keys off `signal_catalog` intersections.
- **No production code modified.** The repo diff for this work is exactly one new file,
  `docs/HACKATHON_DEMO.md`. (The project's `next dev` rewrites `AGENTS.md` incidentally; revert
  that tooling artifact before committing so the diff stays clean.)

---

## 14. Auditability

- **Spec-contract fields**: §5 response shape and §6 cost-control env vars match the
  integrated build contract for `POST /api/v1/route/estimate`.
- **Modeled math (verifiable on this tree)**: `lib/server/signal-model.ts` — unknown signal
  branch (0.5 expected stops / 22.5 s expected delay / `[0, 1]` likely stops / `[0, 60]` likely
  delay per unknown signal) and the `high`/`medium`/`low` ladder in §7.
- **Optimizer (verifiable on this tree)**: `lib/server/departure-recommendation.ts` —
  `scoreSeconds = traffic + mean(signal)`, `scoreRangeSeconds = [traffic+lo, traffic+hi]`,
  tie-break by earliest departure.
- **Timing classification & freshness**: `db/migrations/001_data_foundation.sql` — `signal_catalog`
  LATERAL view (`current_official` iff `now() <= stale_after`, else `stale_official`); the one
  imported card in `data/reference/sfmta-public-timing-cards.csv` with `source_as_of=2022-10-20`,
  `stale_after=2023-10-20`; the 5th/Mission cycle is documented as unverified/reclassified per the
  integrated build (the reviewed JSON in `data/reference/sfmta-5th-mission-reviewed.json` leaves
  phase intervals empty for exactly this reason).
- **No live feed**: `source_definitions` capabilities `cycle_timing:false`,
  `phase_timing:false`, `live_state:false`; `/api/v1/sources` `meta.liveData === false`.
- **Non-regression**: `npm run typecheck && npm run lint && npm test` pass on the devbox tree.
  This confirms nothing else broke; it does **not** exercise the new endpoint wiring (the
  devbox carries an earlier naive estimator) and is not cited as proof of integrated behavior.
