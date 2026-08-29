# SFMTA Signal-Timing Research

Research date: 2026-08-29  
Scope: public SFMTA timing-card PDFs, public SFMTA descriptions of signal operation, and the timing artifacts already present in this repository.

## Executive finding

San Francisco does not appear to publish one current, citywide, machine-readable timing-plan feed. The public material is a mix of individual timing cards, project/TASC packets, engineering analyses, and inventory metadata. The cards are valuable enough to model expected signal delay, but they must be treated as dated evidence rather than live controller state.

The strongest public evidence found so far shows that a plan can vary by time of day and day of week, use a named dial/pattern, coordinate neighboring signals with a cycle and offset, and include actuated, transit-priority, preemption, and pedestrian behavior. That supports a route estimate with confidence and freshness labels; it does not support a promise that a driver will hit every green light.

## Public source inventory

### Local artifacts already downloaded

The repository's [local source index](../data/raw/sfmta-timing-plans/README.md) records downloads made on 2026-08-29.

| Local artifact | Public source | Corridor/intersection | Research value and caveat |
| --- | --- | --- | --- |
| [`5th-st-mission-timing-card.pdf`](../data/raw/sfmta-timing-plans/5th-st-mission-timing-card.pdf) | [SFMTA media 33181](https://www.sfmta.com/media/33181/download?inline=) | 5th Street / Mission Street; the repository reference row identifies CNN `24634000` | Best initial parser fixture in the repo. Reference data records a 90-second cycle and 71-second offset plus time-of-day plans and phase sequence. The PDF is part of a 2022 project packet, so it is stale for current operations unless SFMTA confirms it remains effective. |
| [`mary-mint-mission-tasc-packet.pdf`](../data/raw/sfmta-timing-plans/mary-mint-mission-tasc-packet.pdf) | [SFMTA TASC packet](https://www.sfmta.com/sites/default/files/reports-and-documents/2022/10/item_23_mary_mint_mission_-_tasc_packet.pdf) | Mary Street / Mint Street / Mission Street | Project packet for a new signalized pedestrian crossing; useful for intersection context, pedestrian treatments, and transit routes. It is byte-for-byte identical to the local 5th/Mission file, so it should not be counted as a second independent timing source. |
| [`iscott-summary-sheet.pdf`](../data/raw/sfmta-timing-plans/iscott-summary-sheet.pdf) | [SFMTA ISCOTT summary sheet](https://www.sfmta.com/media/25034/download?inline=) | Cesar Chavez Street / Guerrero Street; CNN `21897000` | Most structured public fixture found. It exposes three dials/plans: 111 (80-second cycle, 45-second offset), 212 (106-second cycle, 103-second offset), and 313 (106-second cycle, 63-second offset), plus phase/movement states and signal intervals. The card says change date 2020-10-30 and includes a 4 AM clock reset note, so it is historical evidence. |
| [`4th-st-mission-bay-testing-timing-card.pdf`](../data/raw/sfmta-timing-plans/4th-st-mission-bay-testing-timing-card.pdf) | [SFMTA media 44595](https://www.sfmta.com/tl/media/44595/download?inline=) | 4th Street / Mission Bay Boulevard South | Testing-card candidate with base timing and actuation. The local copy exists, but the public URL was not reliably text-retrievable during this review and the intersection-to-CNN join is not yet verified. Keep it unimported until manually reviewed. |

The repository currently imports only the 5th/Mission cycle row in [`data/reference/sfmta-public-timing-cards.csv`](../data/reference/sfmta-public-timing-cards.csv). Its `source_as_of` is 2022-10-20 and `stale_after` is 2023-10-20; that is correctly classified as stale official evidence by the application.

### Official operating/rules sources

- [SFMTA Traffic Signals Program](https://www.sfmta.com/traffic-signals-program) — describes timing projects as changes to signal sequence or duration, including leading pedestrian intervals (LPIs) and coordination with adjacent signals. It also describes transit signal priority (TSP), emergency vehicle preemption (EVP), CCTV, and the signal communications network.
- [SFMTA Transportation Engineering](https://www.sfmta.com/es/node/12127) — identifies SFgo/Transit Engineering as responsible for signal-priority plans and the Traffic Signal Shop as responsible for programming complex timing plans and implementing them in the field.
- [SFMTA Green Lights for Muni](https://www.sfmta.com/blog/green-lights-muni) — explains TSP as vehicle-to-signal communication that can hold green or shorten red, and notes that it changes signal lengths for cross traffic and pedestrians while preserving pedestrian clearance. The page also documents Mission corridor TSP deployment, but its 2015 numbers should not be treated as a current inventory.
- [SFMTA A Green Light for Muni Customers](https://www.sfmta.com/blog/green-light-muni-customers) — documents the 2021 Connected Corridor pilot, real-time sensor-informed adjustments, and tradeoffs by direction, mode, pedestrians, and side-street traffic. It explicitly says most SF signals did not have vehicle-detection sensors at the time of that pilot.
- [SFMTA Vision Zero Signal Retiming](https://www.sfmta.com/tl/node/29748) — names corridors where LPIs, pedestrian-clearance updates, green/yellow/all-red changes, and synchronization improvements were implemented or planned. It lists Embarcadero/King, Geary/Park Presidio/25th, Fell/Oak, Dolores/Guerrero/Valencia/Folsom, and Mission/Geneva segments.
- [SFMTA T Third Improvements](https://www.sfmta.com/projects/t-third-improvements) — current project page for a high-value corridor; it says signal timing improvements are being phased along T Third and that additional sensor-enabled work is planned.
- [DataSF Traffic Signals dataset](https://data.sfgov.org/d/ybh5-27n2) and its [SFMTA ArcGIS feature layer](https://services.arcgis.com/Zs2aNLFN00jrS4gG/ArcGIS/rest/services/trafficsignals/FeatureServer/0) — authoritative location/equipment context and join keys, including CNN, signal number, controller model, system/master, vehicle actuation, pedestrian signals/actuation, time-based clock, interconnect, preemption/TSP, detection, and upgrade/project fields. The layer documentation says the GIS export is updated quarterly. It does not publish current phase, cycle, split, offset, or live red/yellow/green state.
- [SFCTA DTA public repository](https://github.com/sfcta/dta) — a useful secondary acquisition lead: its documentation says SF signal timings were kept as individual spreadsheets with complete phasing and time-of-day data. It is not an SFMTA authoritative current feed and should be used to guide records requests, not to establish freshness.

## Fields observed or expected in public cards

The ISCOTT card is the best schema reference currently available. Preserve raw values and provenance; do not collapse a plan into only one cycle number.

| Field group | Fields observed in the public material | Why it matters |
| --- | --- | --- |
| Identity/provenance | intersection name, CNN, change/revision date, engineer, controller/cabinet, operating date, system/master, clock-reset time, source packet/page | Joins a card to the DataSF inventory and determines whether the evidence is still usable |
| Plan selection | dial/pattern/CSO, weekday flags, time windows, sequence, all-other-times/default plan | Selects the plan for a requested departure timestamp |
| Coordination | cycle length, offset, offset reference/phase, interconnect, time-based clock, master/reference intersection | Models progression and arrival phase across a corridor |
| Vehicle phases | phase number, movement/approach, lead/lag, recall mode, minimum and maximum split, start/end/yield/force-off | Determines which approach can receive green and for how long |
| Change/clearance intervals | yellow, all-red, minimum initial, vehicle extension, minimum gap, time-before-reduce, time-to-reduce | Captures actuated extension and safe transitions; avoid treating all green time as usable travel time |
| Pedestrian phases | walk, flashing-don't-walk/clearance, pedestrian phase mappings, LPI-related sequencing | Affects vehicle release and is a safety constraint, not optional delay |
| Special operation | actuation, steady demand, transit priority, emergency preemption, detection, flash mode | Explains why field behavior can differ from the base plan |
| Engineering context | volumes, v/c ratio, control type, natural/actuated cycle, delay, LOS, queues, analysis period | Useful for calibration and historical congestion context, but an analysis scenario is not proof of the current controller program |

## What the rules imply for Glossa

1. Start with a deterministic base-plan simulator: choose the plan by weekday/time window, place the traveler on the route using distance and speed, apply cycle/offset/reference phase, then evaluate the arrival against the movement's green interval.
2. Add uncertainty bands for actuated behavior, pedestrian calls, TSP, EVP, and adaptive/sensor pilots. These are scenario modifiers, not hidden constants.
3. Treat route direction and movement as first-class inputs. A corridor can favor one direction or mode at a given time, and a phase that serves the through movement may not serve a turn.
4. Keep the product language as “estimated stops/delay under the published plan” and show the plan date, source, and confidence. Never display a stale card as live status.
5. Use the DataSF/ArcGIS inventory to identify detector, TSP, preemption, interconnect, and controller capabilities, but do not infer a timing plan from those capability fields alone.

## Freshness and reliability caveats

- The timing-card corpus is sparse and not citywide. Four local PDFs are not four independent intersections: the 5th/Mission file and Mary/Mint/Mission TASC packet are duplicates.
- A publication or download date is not the plan's effective date. Store the plan's revision/change/effective date when present, the fetch date, URL, checksum, and PDF page number.
- The 5th/Mission evidence is from 2022 and the ISCOTT evidence is from 2020. Retain both for historical calibration, but label them stale until SFMTA confirms current use.
- Project pages report completed or planned retiming work, not necessarily the complete controller database. A corridor project is a lead for acquisition, not a substitute for per-intersection cards.
- Static plans can be interrupted or modified by vehicle/pedestrian actuation, transit priority, emergency preemption, adaptive/sensor logic, construction, special events, clock resets, and controller faults.
- Engineering values such as Synchro delay, LOS, v/c, or “natural cycle” describe an analysis case. They should not be inserted as observed live conditions.
- The public SFMTA/DataSF inventory provides no live red/yellow/green state. Any UI output must distinguish `current_official`, `stale_official`, `observed`, `modeled`, and `unknown` as the repository methodology already does.

## Prioritized acquisition list

### P0 — make the demo defensible

1. **Request a current machine-readable export from SFMTA Traffic Signal Shop/SFgo for the demo route(s).** Ask for the existing timing-card/controller export, not a newly created analysis. Require plan/effective dates, weekday/time windows, cycle, phase sequence, splits, yellow/all-red, pedestrian timings, offsets/reference, controller/system/master IDs, actuation, TSP, EVP/preemption, and field definitions. Use the existing [`SFMTA public-records request template`](SFMTA_PUBLIC_RECORDS_REQUEST.md), with a short list of CNNs.
2. **Validate the 5th/Mission join and re-fetch its source.** Confirm CNN `24634000`, extract the actual page-level phase/interval data, and confirm whether the 2022 plan remains programmed. Do not add duplicate Mary/Mint packet rows.
3. **Manually review the 4th/Mission Bay testing card.** Resolve its intersection name, CNN, plan date, cycle, splits, actuation, and whether “testing” means proposed, temporary, or field-installed.
4. **Create a source register before importing more rows.** One row per PDF/card/plan, with source URL, local filename, SHA-256, fetch timestamp, plan date, effective/stale rule, extraction status, CNN match status, and reviewer.

### P1 — highest-value corridors for route recommendations

1. **Mission Street / 14 Mission corridor.** It already has a local card fixture and public SFMTA documentation of TSP; acquire the full corridor in both directions with weekday/time-of-day plans.
2. **T Third / 3rd Street / Bayshore Boulevard.** SFMTA identifies roughly 60 signalized intersections in the historical retiming scope and the current project is still evolving. Acquire the base plans plus sensor/TSP/phase-3 change records; mark old plans separately from current plans.
3. **Cesar Chavez / Guerrero and the ISCOTT-connected network.** Use CNN `21897000` as the parser fixture and acquire neighboring cards so the 80/106-second dial and offset changes can be tested as a progression rather than a single-intersection lookup.
4. **Embarcadero / King Street.** The Vision Zero retiming program identifies this corridor, and it is a compelling waterfront route with coordination and pedestrian-clearance tradeoffs.
5. **Geary Boulevard / Park Presidio / 25th Avenue.** Acquire the coordinated segments and the 38/38R TSP context; separate route direction and transit-priority effects.
6. **Valencia / Folsom / Guerrero / Dolores.** These Vision Zero corridors are useful for testing pedestrian-heavy streets, LPIs, and non-uniform progression.

### P2 — expand coverage and calibration

- North Point / Bay / Marina, Fell / Oak, Mission / Geneva, Van Ness, and NoMa/SoMa.
- Request the historical spreadsheet corpus or controller export referenced by the SFCTA DTA project, with permission/licensing and a data dictionary.
- Build an observation set: route direction, timestamp, approach, arrival speed, red delay, number of stops, pedestrian call/TSP/preemption indicators, and source confidence. Use it to calibrate modeled ranges rather than silently overriding official plans.
- Recheck SFMTA project pages and the signal inventory quarterly; a new retiming project or inventory update should trigger review of affected cards.

## Recommended first acquisition request

“For the attached list of CNNs, please provide the existing electronic traffic-signal timing records in effect during the last 24 months, including every weekday/time-of-day plan and any current default plan. Please include the original timing cards or controller reports, plan/effective/revision dates, cycle, phase/movement sequence, splits, yellow/all-red, pedestrian timing, offset/reference, recall/actuation, TSP, EVP/preemption, detection, system/master/controller identifiers, and a field dictionary. If a card is unavailable, identify the record type and date range rather than substituting an engineering estimate.”

This is enough to build a reliable demo around a few corridors while keeping the citywide product honest: official timing rules where available, current traffic observations from the routing provider, and explicit uncertainty where SFMTA does not publish the live state.
