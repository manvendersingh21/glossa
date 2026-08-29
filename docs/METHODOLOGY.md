# Methodology

## Unit of analysis

The unit is an SFMTA traffic-signal intersection identified by DataSF's CNN, not
an individual mast arm, signal head, or OSM node. The inventory is authoritative
for which intersections and equipment fields Glossa presents. A missing or null
equipment field means “not established by the snapshot,” not “false.” Retired
inventory records are retained for audit but excluded from `signal_catalog`.

OSM `highway=traffic_signals` elements add component and cross-street context.
Matching uses normalized street names, distance, and candidate scoring. Only
records classified as matched contribute to `osmComponentCount`; ambiguous and
unmatched candidates remain in the database for review. OSM never creates an
authoritative intersection or supplies official controller timing.

## Study areas and density

“Downtown” is an explicit, reproducible analytical boundary: the union of the
official SF Planning zoning polygons whose code begins `C-3`. It is not a claim
about every colloquial or agency definition of downtown. A signal is downtown
when its point intersects that versioned union.

- San Francisco land area is the
  [U.S. Census Bureau QuickFacts 2020 land-area value](https://www.census.gov/quickfacts/fact/table/sanfranciscocountycalifornia/LND110220)
  of **46.91 square miles**, stored as an explicit methodological constant.
- Downtown square miles are calculated in PostGIS from the stored C-3 union
  using geography area.
- Road miles sum active DataSF centerline geometries. Downtown roads are clipped
  to the C-3 union before their geodesic length is summed.
- Signals per square mile and per road mile divide the inventory count by those
  denominators. Centerline miles are not lane miles and divided streets can have
  more than one centerline.
- Median nearest-signal distance calculates the geodesic distance from every
  selected signal to its closest other selected signal, then reports the median
  in feet.

The Census constant is documented rather than derived from OSM, and the C-3
area and road metrics are recomputed from each stored source snapshot.

## Timing evidence

The DataSF Traffic Signals inventory currently used by this project does not
publish cycle length, phase timing, or live controller state. Glossa therefore
does not infer timing from that inventory. Imported timing evidence must include
a URL/reference, an as-of date, confidence, rationale, and a stable import key.

The catalog labels its selected evidence as:

- `current_official`: official evidence whose recorded `staleAfter` has not
  passed.
- `stale_official`: official evidence past that date; retained for context.
- `observed`: a dated field observation, not an agency controller record.
- `modeled`: an explicit estimate with a model version and rationale.
- `unknown`: no admissible timing evidence is stored.

The deterministic preference order is current official, stale official,
observed, modeled, then unknown; ties use evidence date and import time. A cycle
range `[min,max]` seconds becomes a cycles-per-hour range
`[3600/max, 3600/min]`; a nominal-only value becomes `[3600/value, 3600/value]`.
This is a mathematical conversion, not a count of actual cycles. Phase splits,
offsets, actuation, coordination, time-of-day plans,
preemption, and field conditions can all make observed operation differ.

Coverage percentages use all signals in the selected study area as the
denominator. “Official” includes current and stale official evidence but is
reported separately from modeled coverage. None of these metrics are live.

## Reproducibility and limitations

Each acquisition stores source URL, fetch time, upstream update time when
available, SHA-256 checksum, counts, and the normalized rows' snapshot link.
`/api/v1/sources` is the freshness record; API response time is not freshness.

Known limitations include source omissions and miscoding, uncertain OSM joins,
the analytical C-3 downtown definition, street-centerline denominator choices,
and sparse public timing evidence. Results support exploration and public-records
research, not signal operations, safety decisions, or real-time navigation.
