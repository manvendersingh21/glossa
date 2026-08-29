# SFMTA Signal-Timing Research

Research date: 2026-08-29
Scope: public SFMTA timing cards, signal plans, retiming documents, and corridor rules for the seven target corridors — **Mission, Market, Geary, Valencia, Folsom, 3rd Street, and Embarcadero** — plus the timing artifacts already referenced by this repository.

## Executive finding

San Francisco does not publish a current, citywide, machine-readable timing-plan feed. The public material found for the seven corridors is a mix of one extractable timing card, project/Board (TASC) packets, program and project web pages that state *rules* (LPIs, pedestrian clearance, green/yellow/all-red, synchronization intent, TSP presence), and one adaptive-signal evaluation report. Only the **“ISCOTT summary sheet”** (Cesar Chavez / Guerrero, change date **2020-10-30**) is a complete, text-extractable controller timing card with CSO dial, cycle, offset, phase sequence, splits, pedestrian timing, and actuation/transit-priority/preemption flags. Every other item is corridor context or capability/equipment metadata, not a per-intersection controller program.

A verification pass against the actual PDFs corrected three errors in the prior research record (see [Corrections](#corrections-to-the-prior-research-record)): the “5th/Mission timing card” is actually the Mary/Mint/Mission new-signal TASC packet and has no extractable timing; the “4th/Mission Bay testing card” is a 2026 Quick-Build packet, not a timing card; and the Connected Corridor final report is dated October 2025 (not 2021) and describes adaptive operation with no fixed cycle. The strongest plan fixture is the ISCOTT card; it is ~6 years old and is therefore **stale-official**, not current.

The result is enough to build a defensible demo around corridors whose *rules* and *capabilities* are public, while remaining honest that the live controller state is not public. Per-intersection timing for the seven corridors beyond ISCOTT must come from a public-records request (see [Prioritized acquisition list](#prioritized-acquisition-list-and-safe-import-plan)).

## Local source inventory

The local downloads (git-ignored) and full provenance — upstream URL, upstream filename, byte size, page count, PDF creation/modification date, SHA-256, and a per-document field matrix — are recorded in [`data/raw/sfmta-timing-plans/README.md`](../data/raw/sfmta-timing-plans/README.md). Summary:

| Local artifact | What it actually is (verified) | Corridor | Timing value present? |
| --- | --- | --- | --- |
| `iscott-summary-sheet.pdf` | Cesar Chavez/Guerrero NLT TASC packet (Item 1); pp.1/3/4 are the **ISCOTT summary sheet** timing card | Guerrero (Valencia/Folsom group) | **Yes** — full card, 2020-10-30 |
| `5th-st-mission-timing-card.pdf` | Mary/Mint/Mission “ESTABLISH TRAFFIC SIGNAL” TASC packet (Item 23, 2022) | Mission | No (new-signal proposal + counts) |
| `mary-mint-mission-tasc-packet.pdf` | Byte-identical duplicate of the above under a second URL | Mission | No (duplicate) |
| `4th-st-mission-bay-testing-timing-card.pdf` | Mission Bay Quick-Build Board packet (Item 14, 2026) | 3rd Street / Mission Bay | No (CEQA quick-build) |
| `sfmta-sid-legend.pdf` | Signal Inventory Diagrams symbols legend (2024) | Reference | No (symbol key) |
| `connected-corridor-final-report.pdf` | AdvanceSF Connected Corridor PoC Final Report (Oct 2025) | 3rd Street | No fixed cycle (adaptive) |
| `bike-signals-fact-sheet.pdf` | Bike Signals & Mixing Zones evaluation fact sheet (2019) | Folsom / 8th-Brannan | No (treatment evaluation) |

## Per-corridor catalog

For each of the seven corridors: authoritative public sources, intersection(s) where identified, publication/revision date, and which timing fields are actually present. Fields: **Cyc**=cycle length, **Off**=coordination offset, **Ph**=phase sequence/splits, **Act**=actuation, **Ped**=pedestrian/LPI, **TSP**=transit-signal priority, **Pre**=preemption. ✓ = present and documented; ✗ = not published; ~ = capability field present in the inventory but no plan value; “img” = present only as a diagram, not OCR-verified.

### Mission Street / 14 Mission
- **Intersection references**: Mary St / Mint St / Mission St (new-signal packet); Mission St between Avalon and Sickles (VZ retiming). No verified per-intersection timing card for Mission.
- **Authoritative public sources**:
  - [Mary/Mint/Mission TASC packet (Item 23, 2022)](../data/raw/sfmta-timing-plans/5th-st-mission-timing-card.pdf) — new signalized pedestrian-crossing proposal; specifies pedestrian countdown signals + APS; **no cycle/offset/phase**. Cyc✗ Off✗ Ph✗ Act✗ Ped~ TSP✗ Pre✗
  - [SFMTA Green Lights for Muni (2015)](https://www.sfmta.com/blog/green-lights-muni) — 64 TSP upgrades along the Mission corridor cut 14 Mission end-to-end travel by ~4–5 min (10%). TSP~ (dated 2015, not a current inventory).
  - [SFMTA Vision Zero Signal Retiming](https://www.sfmta.com/projects/vision-zero-signal-retiming) — Mission St (Avalon–Sickles) and Geneva Ave (San Jose–Prague) listed for LPIs, 3 ft/s pedestrian clearance, green/yellow/all-red updates, and synchronization. Rules only (no per-intersection values).
- **Publication/revision dates**: TASC hearing 2022-09-01, PDF 2022-10-20; TSP blog 2015-01-09; VZ update 2024-08-12 (Mission/Geneva completion not separately dated in the public update).
- **Import verdict**: Do **not** import timing values for Mission from any public source found. Capability (TSP presence on 14 Mission) can be sourced from the DataSF inventory; the VZ rules are corridor-policy context, not a controller program.

### Market Street
- **Intersection references**: Market St 5th–8th (Better Market Street Phase 1); SoMa/Market-adjacent retiming (NoMa/SoMa, completed 2019).
- **Authoritative public sources**:
  - [Better Market Street (SF Public Works/SFMTA)](https://www.sfmta.com/projects/better-market-street) — replaces/upgrades traffic-signal *hardware* (5 new signal poles Phase 1, 5th–8th), substantially complete Feb 2025. **No timing plan.** Hardware-modernization context only.
  - [SFMTA Traffic Signals Program](https://www.sfmta.com/traffic-signals-program) — lists the completed **NoMa/SoMa Signal Retiming** (Nov 2019), covering SoMa including Market-adjacent blocks. Rules/status only.
- **Publication/revision dates**: Better Market Street Phase 1 substantial completion 2025-02-27; NoMa/SoMa retiming completed 2019-11.
- **Import verdict**: No public timing values for Market. Better Market Street + NoMa/SoMa retiming are change-drivers that invalidate any older plan; request current Market/SoMa timing via public records.

### Geary Boulevard / Park Presidio / 25th Avenue
- **Intersection references**: Geary Blvd (Collins St–36th Ave); Park Presidio Blvd (Lake–Fulton); 25th Ave (Lake–Fulton).
- **Authoritative public sources**:
  - [SFMTA Vision Zero Signal Retiming](https://www.sfmta.com/projects/vision-zero-signal-retiming) — Geary/Park Presidio/25th listed; **completed 2023-10-02**. LPIs, 3 ft/s pedestrian clearance, green/yellow/all-red, synchronization.
  - [SFMTA Green Lights for Muni (2015)](https://www.sfmta.com/blog/green-lights-muni) — names 38 Geary among TSP corridors (250 intersections citywide at the time).
- **Publication/revision dates**: VZ update 2024-08-12 (Geary completion 2023-10-02); TSP blog 2015-01-09.
- **Import verdict**: No per-intersection timing values. The 2023-10-02 completion sets a *post-retiming* freshness boundary: any older Geary card is superseded. Request current Geary/Park Presidio/25th timing (note 38/38R TSP context).

### Valencia Street
- **Intersection references**: Valencia St (14th–25th).
- **Authoritative public sources**:
  - [SFMTA Vision Zero Signal Retiming](https://www.sfmta.com/projects/vision-zero-signal-retiming) — Valencia St (14th–25th) listed; **completed 2023-06-21**. LPIs, 3 ft/s pedestrian clearance, green/yellow/all-red, synchronization.
  - [SFMTA Quick-Build Program](https://www.sfmta.com/quick-build-program) — Valencia quick-build changes relevant to phase structure; no controller timing.
- **Publication/revision dates**: VZ update 2024-08-12 (Valencia completion 2023-06-21).
- **Import verdict**: No public timing values. Treat 2023-06-21 as the post-retiming boundary. Valencia is pedestrian/bike-heavy — phase structure may include bike-specific phases (see bike-signals treatment model).

### Folsom Street
- **Intersection references**: Folsom St (14th–24th) [VZ]; Folsom/8th and 8th/Brannan [bike-signal treatment]; Folsom/19th [Contract 35 modification].
- **Authoritative public sources**:
  - [SFMTA Vision Zero Signal Retiming](https://www.sfmta.com/projects/vision-zero-signal-retiming) — Folsom St (14th–24th) listed; **completed 2023-07-10**. LPIs, 3 ft/s, green/yellow/all-red, sync.
  - [Bike Signals & Mixing Zones fact sheet (2019)](../data/raw/sfmta-timing-plans/bike-signals-fact-sheet.pdf) — documents **separated bike-signal phasing** at Folsom/8th (and 8th/Brannan): a phase-structure treatment (bike phase separated from turning vehicles). Not cycle/offset, but it constrains the phase model.
  - [SFMTA Traffic Signals Program](https://www.sfmta.com/traffic-signals-program) — NoMa/SoMa retiming (2019) and Contract 35 signal modifications (19th/Folsom image) listed.
- **Publication/revision dates**: VZ Folsom completion 2023-07-10; bike-signal fact sheet 2019-03-14; NoMa/SoMa retiming 2019-11.
- **Import verdict**: No cycle/offset values. Import the **phase-treatment** fact (separated bike signal at Folsom/8th) as corridor context. Treat 2023-07-10 as the post-retiming boundary.

### 3rd Street / T Third
- **Intersection references**: 3rd St (Channel–20th, 10-intersection test corridor); 3rd/Campus, 3rd/16th, 16th/Terry Francois, Terry Francois/Warriors, Mission Bay Blvd North; T Third SoMa/Bayview.
- **Authoritative public sources**:
  - [SFMTA T Third Improvements](https://www.sfmta.com/projects/t-third-improvements) — phased signal-timing + TSP: Phase 1 (Summer 2025, Bryant–Berry), Phase 2 (Spring 2026, Berry–Cargo Way + Kirkwood), Phase 3 (2H2026, Bayview/Visitacion Valley). Rules/status (reported savings: up to 7 min roundtrip PM).
  - [AdvanceSF Connected Corridor Final Report (Oct 2025)](../data/raw/sfmta-timing-plans/connected-corridor-final-report.pdf) — 3rd Street Mission Bay adaptive, sensor-informed signal timing; LiDAR/platform sensors; red-light delay −73%, LRV travel time −66 s. **Adaptive/dynamic — no fixed cycle**. Documents the 10 test intersections and TSP-by-sensor operation.
  - [Mission Bay Quick-Build packet (Item 14, 2026)](../data/raw/sfmta-timing-plans/4th-st-mission-bay-testing-timing-card.pdf) — quick-build bikeway/school-zone proposal, not a timing card.
- **Publication/revision dates**: Final report 2025-10; T Third phases 2025–2026; Quick-Build packet 2026-01/03.
- **Import verdict**: Do **not** import fixed cycle/offset for 3rd Street — the corridor is adaptive/sensor-informed (fixed values would misrepresent operation). Carry TSP/adaptive as scenario modifiers and the 10-intersection list as the highest-value acquisition target for *current* controller/adaptive parameters.

### Embarcadero / King Street
- **Intersection references**: The Embarcadero (North Point Ave–King St); King St (Embarcadero–5th St).
- **Authoritative public sources**:
  - [SFMTA Vision Zero Signal Retiming](https://www.sfmta.com/projects/vision-zero-signal-retiming) — Embarcadero (North Point–King) and King (Embarcadero–5th) listed. LPIs, 3 ft/s, green/yellow/all-red, synchronization.
- **Publication/revision dates**: VZ update 2024-08-12 (Embarcadero/King completion not separately dated in the public update).
- **Import verdict**: No public timing values. Embarcadero/King is a coordinated waterfront corridor with pedestrian-clearance tradeoffs — a high-value acquisition target. Request current timing; until then keep `unknown` per the methodology.

## Verified fields of the ISCOTT summary sheet (the one complete public card)

Extracted from [`iscott-summary-sheet.pdf`](../data/raw/sfmta-timing-plans/iscott-summary-sheet.pdf) pp.1/3/4 on 2026-08-29. This is the schema reference for any future card import.

| Field group | Verified values |
| --- | --- |
| Identity/provenance | Intersection Guerrero St / Cesar Chavez St; **CNN 21897000**; engineer E. Luu; controller 2070; ProgFlash; cabinet M-SF; Oper. Date 1/3/1949; **change date 2020-10-30**; clock reset 4 AM; pages 1–3 of 3; PreStaff 2020-11-24 |
| Plan selection | CSO dials **111 / 212 / 313** with a day-of-week × time-of-day schedule matrix and an **“ALL OTHER TIMES”** default row (exact windows need image review) |
| Coordination | Cycle **80 s** (dial 111), **106 s** (dials 212 & 313); offsets **45 s**, **103 s**, **63 s**; Transition Parameters |
| Vehicle phases | Phases **1–15**; movement/street row; splits; Min/Max Green |
| Change/clearance | All-Red (All R); Min Walk; FRH (pedestrian flashing clearance); change note: “Increase Dial 111 to 80 s … Update Offsets. Add Phase 1 WBL Y & R arrows. Remove Phase 2 EBL. Update to WS 3.0: Splits, Min/Max G, All R, Min Walk, FRH” |
| Pedestrian | Min Walk, FRH; north-side pedestrian crossing-time increase (proposal context) |
| Special operation | **Actuation** (X/— column), **Transit Priority** (X/— column), **Preemption** (X/— column), EmerFlash, ProgFlash |
| Engineering context (NOT the live plan) | Synchro Actuated/Effective Green, PHF, Turn Type (Prot/Perm/pm+ov), v/c, LOS, AM/PM volumes, CVC 21453(a) collision history |

### How the rules translate to the seven corridors

The Vision Zero Signal Retiming rules (LPIs; pedestrian clearance at 3 ft/s; updated green/yellow/all-red; synchronization where possible) are **policy rules**, not numeric plans. They tell us a post-retiming boundary date per corridor (Dolores/Guerrero 2023-04-22, Valencia 2023-06-21, Folsom 2023-07-10, Geary/Park Presidio/25th 2023-10-02, various 2024-01-15, Fell/Oak 2024-04-07) and that any older card on those corridors is superseded. The DataSF inventory provides capability (actuation, pedestrian signal/actuation, APS, transitPriority, emergencyPreemption, controller model, system/master, time-based clock, interconnect, detection) but explicitly **no** phase/cycle/offset.

## Corrections to the prior research record

These corrections come from downloading the actual PDFs and extracting their text layer on 2026-08-29; they supersede descriptions in the earlier version of this document.

1. **“5th/Mission timing card” (media 33181) is mislabeled.** The upstream `content-disposition` is `item_23_mary_mint_mission_-_tasc_packet.pdf`; the content is the **Mary/Mint/Mission “ESTABLISH – TRAFFIC SIGNAL” TASC packet (Item 23, Contract 66)**, hearing 2022-09-01. It is a *new-signal* proposal and contains pedestrian-count/bike-count/vehicle-count data, not a 90-second cycle / 71-second offset plan. Those values are **not present in the extractable text** (some pages are image-only and were not OCR-verified). The earlier claim that this fixture documents a 5th St/Mission (CNN `24634000`) 90 s / 71 s plan is not supported by the source. **Action taken (2026-08-29):** the imported `data/reference/sfmta-public-timing-cards.csv` row `sfmta-5th-mission-public-card-2022` (cnn `24634000`) has been reclassified from `official` to **`modeled`** with `confidence = unknown` and `model_version = unverified-retained`. The 90 s `cycle_nominal_seconds` is kept **only** to preserve the `import_key` reference and is explicitly **not** asserted as the real controller cycle; the rationale states that no 90 s cycle is text-extractable from media/33181. `source_as_of` (2022-10-20) and `stale_after` (2023-10-20) are preserved. This row now signals “effectively unknown,” not a verified plan.
2. **“Mary/Mint/Mission TASC packet” is a byte-for-byte duplicate.** `mary-mint-mission-tasc-packet.pdf` and `5th-st-mission-timing-card.pdf` share SHA-256 `fb5ea3f4…`; they are one document under two URLs (media/33181 and the `/sites/default/files/...` path). Count them once.
3. **“4th/Mission Bay testing timing card” (media 44595) is a Quick-Build packet, not a testing card.** Upstream filename is `Item14_Mission Bay Quick-Build.pdf`, created 2026-01-26, modified 2026-03-04. It is a CEQA categorical quick-build (bikeway, school-zone striping, traffic calming). “Signal timing modifications” appears only as an eligible activity in the exemption text. No cycle/offset/phase. Keep unimported.
4. **Connected Corridor final report is October 2025, not Fall 2021.** The 2021 blog/Phase-1 dates describe the pilot; the [AdvanceSF Connected Corridor PoC Final Report](https://www.sfmta.com/media/43838/download?inline=) (PDF created 2025-10-17) is the finished report. It documents **adaptive/sensor-informed** operation on 3rd Street with no fixed cycle/offset; do not import fixed timing from it.
5. **ISCOTT “change date 2020-10-30” is verified.** It appears at lines 87/145 of the extracted text (next to “Date Completed”). The prior record was correct; the dial/cycle/offset values (111/80/45, 212/106/103, 313/106/63) are also verified.

## Field schema for future acquisition

Preserve raw provenance; do not collapse a plan to a single cycle number. Required per-plan record: source URL, local filename, SHA-256, fetch date, plan/effective/revision date, PDF page numbers, CNN (or signal number), corridor, dial/pattern, day/time window, cycle, offset (+ reference phase), phase sequence, splits/Min/Max green, yellow, all-red, Min Walk, FRH, actuation, transit priority, preemption, controller/system/master, and whether the plan is a controller program or an engineering (Synchro) scenario.

## Freshness and reliability caveats

- Only **one** complete public timing card was found (ISCOTT, 2020-10-30). It serves a Guerrero/Cesar Chavez intersection (grouped with Valencia/Folsom in Vision Zero retiming). Coverage of the seven corridors by *machine-readable timing values* is essentially zero.
- A publication/download date is not a plan’s effective date. The ISCOTT card’s change date (2020-10-30) is ~6 years before this research date → classify **stale_official**, not current.
- The Vision Zero completion dates are post-retiming boundaries: any older card on Geary (pre-2023-10), Valencia (pre-2023-06), Folsom (pre-2023-07), Guerrero/Dolores (pre-2023-04), or the Embarcadero/King corridor is superseded.
- 3rd Street is adaptive/sensor-informed (Connected Corridor) and being re-retimed in phases (T Third, 2025–2026). Any static plan there is at best a momentary snapshot.
- Static plans are interrupted by vehicle/pedestrian actuation, transit priority, emergency preemption, adaptive/sensor logic, construction, special events, clock resets (ISCOTT: 4 AM), and controller faults.
- Engineering values (Synchro delay, LOS, v/c, “natural cycle”, Actuated/Effective Green) are analysis scenarios, not the live controller program — already labeled in the ISCOTT extraction and in the application methodology.
- The public DataSF/ArcGIS inventory has no live red/yellow/green state and no phase/cycle/offset. UI must keep the `current_official` / `stale_official` / `observed` / `modeled` / `unknown` distinction.

## Prioritized acquisition list and safe-import plan

Definition of done: a prioritized list of timing plans that can be **safely imported into Glossa** now, with everything else routed to public-records acquisition. Per the importer, `official` rows require `source_as_of` + `stale_after`; `modeled` rows require `model_version`; `unknown` (no admissible evidence) is the default.

### Tier A — imported now (one CSV row)

1. **ISCOTT summary sheet — Cesar Chavez/Guerrero (CNN 21897000).** Added to `data/reference/sfmta-public-timing-cards.csv` as a new `official` row (`import_key = sfmta-iscott-cesar-chavez-guerrero-2020`); the database view derives **stale_official** from `source_as_of = 2020-10-30` / `stale_after = 2021-10-30`. Every value in the CSV row is verified from the extracted PDF text (pp.1/3/4): CNN `21897000`; cycle range **80–106 s** (`cycle_min=80`, `cycle_max=106`, no single nominal because the cycle varies by dial). The CSV captures cycle-level evidence only — the **offsets (45/103/63 s)**, **dials 111/212/313**, **phases 1–15**, splits/Min-Max G, All-R, Min Walk, FRH, and actuation/transit-priority/preemption flags remain documented in the source PDF and in the [verified fields table](#verified-fields-of-the-iscott-summary-sheet-the-one-complete-public-card) above. Source: `https://www.sfmta.com/media/25034/download?inline=` (local `iscott-summary-sheet.pdf`). **Do not** assert the day/time windows until the schedule matrix is transcribed from the page image.

### Tier B — do not import as timing; import as context/capability only

2. **Mission (Mary/Mint/Mission)** — import as project context only (new-signal proposal, 2022). No timing values. The previously imported `cnn 24634000` / 90 s row has been reclassified to `modeled` / `unknown` (see [correction #1](#corrections-to-the-prior-research-record)): the 90 s is a retained-unverified placeholder, **not** a verified cycle, and must not be presented as real timing.
3. **3rd Street / Mission Bay** — import the Connected Corridor final report and T Third project page as corridor context (adaptive + TSP). Do **not** import fixed cycle/offset (operation is dynamic). Collect the 10 test intersections as a capability/asset list.
4. **Folsom / 8th bike-signal treatment** — import the separated-bike-signal phase treatment (2019 fact sheet) as a phase-structure note for Folsom, not as cycle timing.
5. **Embarcadero/King, Geary/Park Presidio/25th, Valencia, Market/SoMa** — import the Vision Zero retiming rules and completion dates as per-corridor policy context and post-retiming boundaries; no timing values. Capability (TSP/preemption/actuation) from the DataSF inventory.

### Tier C — acquire via public-records request before import (highest-value first)

Use the editable [`SFMTA public-records request template`](SFMTA_PUBLIC_RECORDS_REQUEST.md) with the CNN/signal-number list per corridor. Priority is by demo value and by how much public context already constrains the answer:

1. **3rd Street / T Third** (both directions, all TOD plans) — adaptive + TSP; request current controller/adaptive parameters for the 10 Connected-Corridor intersections plus the T Third phase 1–2 segments. Highest value, most likely to have changed.
2. **Geary / Park Presidio / 25th** (coordinated, 38/38R TSP context) — request post-2023-10-02 timing; separate direction and TSP effects.
3. **Embarcadero / King** (coordinated waterfront) — request current coordination + pedestrian-clearance timing.
4. **Valencia (14th–25th) and Folsom (14th–24th)** — request post-retiming timing including LPI and bike-signal phase structure (Folsom/8th).
5. **Mission / 14 Mission** — request current corridor timing in both directions with TOD plans and TSP; separately request the actual timing card (if any) for the Mary/Mint/Mission new signal and clarify the CNN `24634000` attribution.
6. **Market / SoMa** — request current Market and SoMa timing (post Better-Market-Street Phase 1 and NoMa/SoMa retiming).

### Suggested first request (verbatim from the template spirit)

> For the attached CNNs, provide the existing electronic traffic-signal timing records in effect during the last 24 months, including every weekday/time-of-day plan and any current default plan. Include the original timing cards or controller reports, plan/effective/revision dates, cycle, phase/movement sequence, splits, yellow/all-red, pedestrian timing, offset/reference, recall/actuation, TSP, EVP/preemption, detection, system/master/controller identifiers, and a field dictionary. If a card is unavailable, identify the record type and date range rather than substituting an engineering estimate, and indicate whether the controller program differs from any Synchro/analysis export.

This keeps the product honest: one verified stale-official card now, corridor rules and capabilities as context, and a prioritized path to current per-intersection timing through the public-records channel.
