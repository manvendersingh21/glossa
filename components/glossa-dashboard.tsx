"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AreaStats, SignalFeature, SignalFeatureCollection } from "@/lib/contracts";
import {
  CAPABILITY_FILTERS,
  TIMING_COLORS,
  TIMING_FILTERS,
  filterSignals,
  formatCycle,
  formatDate,
  formatNumber,
  safeExternalUrl,
  signalsApiUrl,
  timingExplanation,
  timingLabel,
  type Area,
  type CapabilityFilter,
  type LayerMode,
  type TimingFilter,
} from "./dashboard-utils";
import {
  ChevronIcon,
  ClockIcon,
  CloseIcon,
  ExternalLinkIcon,
  FilterIcon,
  InfoIcon,
  LayersIcon,
  MapIcon,
  RefreshIcon,
  SignalIcon,
} from "./icons";
import { SignalMap } from "./signal-map";
import { RoutePlanner, type RouteEstimate } from "./route-planner";

const INITIAL_TIMING_FILTERS = new Set<TimingFilter>([
  "official",
  "observed",
  "modeled",
  "unknown",
]);

async function fetchJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!response.ok) {
    let detail = "";
    try {
      const body = (await response.json()) as {
        error?: string | { message?: string };
        message?: string;
      };
      if (typeof body.message === "string") detail = body.message;
      else if (typeof body.error === "string") detail = body.error;
      else if (typeof body.error?.message === "string") detail = body.error.message;
    } catch {
      // An HTTP status is enough when the response is not JSON.
    }
    throw new Error(detail || `Request failed with status ${response.status}.`);
  }
  return (await response.json()) as T;
}

export function GlossaDashboard() {
  const [area, setArea] = useState<Area>("downtown");
  const [layerMode, setLayerMode] = useState<LayerMode>("clusters");
  const [capability, setCapability] = useState<CapabilityFilter>("all");
  const [timingFilters, setTimingFilters] = useState<Set<TimingFilter>>(
    () => new Set(INITIAL_TIMING_FILTERS),
  );
  const [collection, setCollection] = useState<SignalFeatureCollection | null>(null);
  const [stats, setStats] = useState<AreaStats | null>(null);
  const [selected, setSelected] = useState<SignalFeature | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statsError, setStatsError] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [route, setRoute] = useState<RouteEstimate | null>(null);

  const handleRouteChange = useCallback((nextRoute: RouteEstimate | null) => {
    setRoute(nextRoute);
    if (nextRoute) {
      window.requestAnimationFrame(() => {
        document.getElementById("main-map")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    }
  }, []);

  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";
  const mapConfigured = Boolean(
    mapboxToken.startsWith("pk.") && !mapboxToken.includes("replace_me"),
  );

  useEffect(() => {
    const controller = new AbortController();

    const signalsRequest = fetchJson<SignalFeatureCollection>(
      signalsApiUrl(area),
      controller.signal,
    );
    const statsRequest = fetchJson<AreaStats>(`/api/v1/stats?area=${area}`, controller.signal);

    void Promise.allSettled([signalsRequest, statsRequest]).then(([signalsResult, statsResult]) => {
      if (controller.signal.aborted) return;

      if (signalsResult.status === "fulfilled") {
        setCollection(signalsResult.value);
      } else {
        setCollection(null);
        setLoadError(
          signalsResult.reason instanceof Error
            ? signalsResult.reason.message
            : "Signal data could not be loaded.",
        );
      }

      if (statsResult.status === "fulfilled") {
        setStats(statsResult.value);
      } else {
        setStats(null);
        setStatsError(true);
      }
      setLoading(false);
    });

    return () => controller.abort();
  }, [area, retryKey]);

  const filteredSignals = useMemo(
    () => filterSignals(collection?.features ?? [], timingFilters, capability),
    [capability, collection, timingFilters],
  );

  const visibleSelected =
    selected && filteredSignals.some((feature) => feature.id === selected.id) ? selected : null;

  const beginRequest = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    setStatsError(false);
    setMapError(null);
    setCollection(null);
    setStats(null);
    setSelected(null);
  }, []);

  const changeArea = useCallback(
    (nextArea: Area) => {
      if (nextArea === area) return;
      beginRequest();
      setArea(nextArea);
    },
    [area, beginRequest],
  );

  const retry = useCallback(() => {
    beginRequest();
    setRetryKey((key) => key + 1);
  }, [beginRequest]);

  const resetFilters = useCallback(() => {
    setSelected(null);
    setCapability("all");
    setTimingFilters(new Set(INITIAL_TIMING_FILTERS));
  }, []);

  const toggleTimingFilter = useCallback((filter: TimingFilter) => {
    setSelected(null);
    setTimingFilters((previous) => {
      const next = new Set(previous);
      if (next.has(filter)) next.delete(filter);
      else next.add(filter);
      return next;
    });
  }, []);

  const generatedAt = collection?.meta.generatedAt;
  const areaLabel = area === "downtown" ? "Downtown" : "San Francisco";

  return (
    <main className="dashboard-shell">
      <header className="app-header">
        <a className="brand" href="#main-map" aria-label="Glossa map home">
          <span className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span className="brand-copy">
            <strong>Glossa</strong>
            <small>San Francisco signal atlas</small>
          </span>
        </a>

        <fieldset className="area-switcher">
          <legend className="sr-only">Map area</legend>
          <button
            type="button"
            aria-pressed={area === "downtown"}
            onClick={() => changeArea("downtown")}
          >
            Downtown
          </button>
          <button type="button" aria-pressed={area === "sf"} onClick={() => changeArea("sf")}>
            All SF
          </button>
        </fieldset>

        <div className="snapshot-stamp" title="This map is a dated planning snapshot, not a live feed.">
          <span className="snapshot-dot" aria-hidden="true" />
          <span>
            <small>Planning snapshot</small>
            <strong>{generatedAt ? formatDate(generatedAt) : loading ? "Loading…" : "Unavailable"}</strong>
          </span>
        </div>
      </header>

      <div className="dashboard-workspace">
        <aside className="control-rail" aria-label="Map filters and summary">
          <section className="rail-intro">
            <p className="eyebrow">Explore the network</p>
            <h1>Signals, in context.</h1>
            <p>
              Explore locations, equipment, and timing evidence. This is a dated research view—not
              a live traffic or controller feed.
            </p>
          </section>

          <section className="stats-section" aria-labelledby="stats-heading">
            <div className="section-heading">
              <div>
                <p className="eyebrow">At a glance</p>
                <h2 id="stats-heading">{areaLabel}</h2>
              </div>
              {loading ? <span className="loading-label">Loading</span> : null}
            </div>
            <div className="stats-grid">
              <StatCard
                label="Signals"
                value={loading || !collection ? null : filteredSignals.length}
                suffix={
                  collection && filteredSignals.length !== collection.features.length
                    ? `of ${formatNumber(collection.features.length)}`
                    : "mapped"
                }
              />
              <StatCard
                label="Density"
                value={stats?.signalsPerSquareMile}
                digits={1}
                suffix="per sq mi"
              />
              <StatCard
                label="Timing coverage"
                value={stats?.timingCoveragePercent}
                suffix="percent"
                append="%"
              />
              <StatCard
                label="Published timing"
                value={stats?.officialTimingPercent}
                suffix="official"
                append="%"
              />
            </div>
            {statsError && !loading ? (
              <p className="inline-notice">Area statistics are temporarily unavailable.</p>
            ) : null}
          </section>

          <section className="filters-section" aria-labelledby="filter-heading">
            <div className="section-heading compact">
              <div className="heading-with-icon">
                <FilterIcon />
                <h2 id="filter-heading">Filter signals</h2>
              </div>
              {(capability !== "all" || timingFilters.size !== INITIAL_TIMING_FILTERS.size) && (
                <button className="text-button" type="button" onClick={resetFilters}>
                  Reset
                </button>
              )}
            </div>

            <label className="select-label" htmlFor="capability-filter">
              <span>Capability</span>
              <div className="select-wrap">
                <select
                  id="capability-filter"
                  value={capability}
                  onChange={(event) => {
                    setSelected(null);
                    setCapability(event.target.value as CapabilityFilter);
                  }}
                >
                  {CAPABILITY_FILTERS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <ChevronIcon />
              </div>
            </label>

            <fieldset className="timing-filters">
              <legend>Timing evidence</legend>
              {TIMING_FILTERS.map((filter) => (
                <label key={filter.value} className={`timing-check timing-check-${filter.value}`}>
                  <input
                    type="checkbox"
                    checked={timingFilters.has(filter.value)}
                    onChange={() => toggleTimingFilter(filter.value)}
                  />
                  <span
                    className="legend-swatch"
                    style={{
                      background:
                        filter.value === "official"
                          ? `linear-gradient(135deg, ${TIMING_COLORS.current_official} 50%, ${TIMING_COLORS.stale_official} 50%)`
                          : TIMING_COLORS[filter.kinds[0]],
                    }}
                    aria-hidden="true"
                  />
                  <span className="timing-check-copy">
                    <strong>{filter.label}</strong>
                    <small>{filter.description}</small>
                  </span>
                  <span className="check-mark" aria-hidden="true">
                    ✓
                  </span>
                </label>
              ))}
            </fieldset>
          </section>

          <RoutePlanner onRouteChange={handleRouteChange} />

          <SourceSummary collection={collection} loading={loading} />
        </aside>

        <section className="map-stage" id="main-map" aria-label="Interactive signal map">
          <div className="map-toolbar" aria-label="Map visualization">
            <span className="map-toolbar-label">
              <LayersIcon />
              View
            </span>
            {(
              [
                ["clusters", "Clusters"],
                ["heatmap", "Density"],
                ["points", "Points"],
              ] as Array<[LayerMode, string]>
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={layerMode === value}
                onClick={() => setLayerMode(value)}
              >
                {label}
              </button>
            ))}
          </div>

          {mapConfigured ? (
            <SignalMap
              token={mapboxToken}
              area={area}
              mode={layerMode}
              features={filteredSignals}
              selectedFeature={visibleSelected}
              onSelect={setSelected}
              onError={(message) => setMapError(message)}
              route={route}
            />
          ) : (
            <MapFallback
              title="Map preview isn’t configured"
              message="Add a public, URL-restricted NEXT_PUBLIC_MAPBOX_TOKEN to enable the interactive map. Signal data remains available below."
              features={filteredSignals}
              onSelect={setSelected}
            />
          )}

          {loading ? (
            <MapMessage icon={<SignalIcon />} title="Loading the signal snapshot…">
              Fetching mapped locations and summary statistics.
            </MapMessage>
          ) : null}

          {!loading && loadError ? (
            <MapMessage icon={<InfoIcon />} title="Signal data is unavailable">
              <span>{loadError}</span>
              <button className="retry-button" type="button" onClick={retry}>
                <RefreshIcon /> Retry
              </button>
            </MapMessage>
          ) : null}

          {!loading && !loadError && collection && filteredSignals.length === 0 ? (
            <MapMessage icon={<FilterIcon />} title="No signals match these filters">
              <button className="retry-button" type="button" onClick={resetFilters}>
                Clear filters
              </button>
            </MapMessage>
          ) : null}

          {mapConfigured && mapError ? (
            <MapFallback
              compact
              title="The basemap could not load"
              message={mapError}
              features={filteredSignals}
              onSelect={setSelected}
            />
          ) : null}

          {route ? (
            <div className="route-map-key" aria-label="Planned route legend">
              <span className="route-map-key-line" aria-hidden="true" />
              <span>route displayed</span>
              <span className="route-map-key-dot" aria-hidden="true" />
              <span>{route.signals.length} signal stops</span>
            </div>
          ) : null}

          <div className="map-key" aria-label={`${filteredSignals.length} filtered results`}>
            <span className="map-key-count">{formatNumber(filteredSignals.length)}</span>
            <span>signals shown</span>
          </div>

          <div className="map-attribution">
            <a href="https://www.mapbox.com/about/maps/" target="_blank" rel="noreferrer">
              © Mapbox
            </a>
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
              © OpenStreetMap
            </a>
          </div>

          {visibleSelected ? (
            <SignalDetails signal={visibleSelected} onClose={() => setSelected(null)} />
          ) : null}
        </section>
      </div>
    </main>
  );
}

function StatCard({
  label,
  value,
  suffix,
  append = "",
  digits = 0,
}: {
  label: string;
  value: number | null | undefined;
  suffix: string;
  append?: string;
  digits?: number;
}) {
  return (
    <article className="stat-card">
      <span>{label}</span>
      <strong className={value === null || value === undefined ? "stat-placeholder" : undefined}>
        {value === null || value === undefined ? "—" : `${formatNumber(value, digits)}${append}`}
      </strong>
      <small>{suffix}</small>
    </article>
  );
}

function SourceSummary({
  collection,
  loading,
}: {
  collection: SignalFeatureCollection | null;
  loading: boolean;
}) {
  const sources = collection?.meta.sources ?? [];
  return (
    <section className="source-section" aria-labelledby="source-heading">
      <div className="section-heading compact">
        <div>
          <p className="eyebrow">Provenance</p>
          <h2 id="source-heading">Source freshness</h2>
        </div>
      </div>
      {loading ? (
        <div className="source-skeleton" aria-label="Loading source details" />
      ) : sources.length ? (
        <ul className="source-list">
          {sources.map((source) => {
            const url = safeExternalUrl(source.url);
            return (
              <li key={`${source.name}-${source.url}`}>
                <span>
                  <strong>{source.name}</strong>
                  <small>As of {formatDate(source.asOf)}</small>
                </span>
                {url ? (
                  <a href={url} target="_blank" rel="noreferrer" aria-label={`Open ${source.name} source`}>
                    <ExternalLinkIcon />
                  </a>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="inline-notice">Source dates are not available.</p>
      )}
      {collection?.meta.attribution.length ? (
        <p className="data-attribution">{collection.meta.attribution.join(" · ")}</p>
      ) : null}
    </section>
  );
}

function MapMessage({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="map-message" role="status">
      <span className="map-message-icon">{icon}</span>
      <div>
        <strong>{title}</strong>
        <div className="map-message-body">{children}</div>
      </div>
    </div>
  );
}

function MapFallback({
  title,
  message,
  features,
  onSelect,
  compact = false,
}: {
  title: string;
  message: string;
  features: SignalFeature[];
  onSelect: (feature: SignalFeature) => void;
  compact?: boolean;
}) {
  return (
    <div className={`map-fallback ${compact ? "map-fallback-compact" : ""}`} role="region" aria-label={title}>
      <div className="fallback-grid" aria-hidden="true">
        <span className="fallback-road fallback-road-a" />
        <span className="fallback-road fallback-road-b" />
        <span className="fallback-road fallback-road-c" />
        {Array.from({ length: 9 }, (_, index) => (
          <i key={index} />
        ))}
      </div>
      <div className="fallback-card">
        <MapIcon />
        <h2>{title}</h2>
        <p>{message}</p>
        {features.length ? (
          <div className="fallback-results">
            <strong>{formatNumber(features.length)} signals in this view</strong>
            <ul>
              {features.slice(0, compact ? 3 : 6).map((feature) => (
                <li key={feature.id}>
                  <button type="button" onClick={() => onSelect(feature)}>
                    <span>
                      <strong>{feature.properties.name}</strong>
                      <small>{timingLabel(feature.properties.timing.kind)}</small>
                    </span>
                    <ChevronIcon />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SignalDetails({ signal, onClose }: { signal: SignalFeature; onClose: () => void }) {
  const panelRef = useRef<HTMLElement>(null);
  const { properties } = signal;
  const timing = properties.timing;
  const sourceUrl = safeExternalUrl(timing.sourceUrl);

  useEffect(() => {
    panelRef.current?.focus();
  }, [signal.id]);

  return (
    <aside
      ref={panelRef}
      className="detail-panel"
      aria-labelledby="detail-title"
      tabIndex={-1}
    >
      <div className="detail-header">
        <div>
          <span className={`timing-badge timing-${timing.kind}`}>
            <span style={{ background: TIMING_COLORS[timing.kind] }} aria-hidden="true" />
            {timingLabel(timing.kind)}
          </span>
          <h2 id="detail-title">{properties.name}</h2>
          <p>
            {properties.signalNumber ? `Signal ${properties.signalNumber}` : "Signal number unavailable"}
            <span aria-hidden="true"> · </span>
            CNN {properties.cnn}
          </p>
        </div>
        <button className="close-button" type="button" onClick={onClose} aria-label="Close signal details">
          <CloseIcon />
        </button>
      </div>

      <div className="timing-summary-card">
        <div className="timing-summary-icon">
          <ClockIcon />
        </div>
        <div>
          <span>{timing.kind === "unknown" ? "Cycle timing" : "Reported cycle"}</span>
          <strong>{formatCycle(signal)}</strong>
          {timing.cyclesPerHourRange ? (
            <small>
              {formatNumber(timing.cyclesPerHourRange[0])}–{formatNumber(timing.cyclesPerHourRange[1])} cycles/hour
            </small>
          ) : null}
        </div>
        <span className={`confidence confidence-${timing.confidence}`}>
          {timing.confidence === "unknown" ? "Confidence unknown" : `${timing.confidence} confidence`}
        </span>
      </div>

      <div className="evidence-note">
        <InfoIcon />
        <p>{timingExplanation(timing.kind)}</p>
      </div>

      {timing.rationale.length ? (
        <section className="detail-section" aria-labelledby="basis-title">
          <h3 id="basis-title">Evidence &amp; assumptions</h3>
          <ul className="rationale-list">
            {timing.rationale.map((item, index) => (
              <li key={`${item}-${index}`}>{item}</li>
            ))}
          </ul>
          {timing.modelVersion ? <p className="model-version">Model {timing.modelVersion}</p> : null}
        </section>
      ) : null}

      <section className="detail-section" aria-labelledby="capability-title">
        <h3 id="capability-title">Recorded capabilities</h3>
        <dl className="capability-grid">
          <Capability label="Vehicle actuation" value={properties.vehicleActuated} />
          <Capability label="Pedestrian signal" value={properties.pedestrianSignal} />
          <Capability label="Pedestrian actuation" value={properties.pedestrianActuated} />
          <Capability label="Accessible pedestrian" value={properties.accessiblePedestrianSignal} />
          <Capability label="Transit priority" value={properties.transitPriority} />
          <Capability label="Emergency preemption" value={properties.emergencyPreemption} />
          <Capability label="Red-light camera" value={properties.redLightCamera} />
          <Capability
            label="OSM components"
            value={properties.osmComponentCount ? String(properties.osmComponentCount) : null}
          />
        </dl>
      </section>

      <section className="detail-section detail-record" aria-labelledby="record-title">
        <h3 id="record-title">Record details</h3>
        <dl>
          <div>
            <dt>Inventory as of</dt>
            <dd>{formatDate(properties.inventoryAsOf)}</dd>
          </div>
          <div>
            <dt>OpenStreetMap as of</dt>
            <dd>{formatDate(properties.osmAsOf)}</dd>
          </div>
          <div>
            <dt>Timing source as of</dt>
            <dd>{formatDate(timing.sourceAsOf)}</dd>
          </div>
          <div>
            <dt>Coordinates</dt>
            <dd>
              {signal.geometry.coordinates[1].toFixed(5)}, {signal.geometry.coordinates[0].toFixed(5)}
            </dd>
          </div>
        </dl>
        {sourceUrl ? (
          <a className="source-link" href={sourceUrl} target="_blank" rel="noreferrer">
            Open timing source <ExternalLinkIcon />
          </a>
        ) : null}
      </section>
    </aside>
  );
}

function Capability({ label, value }: { label: string; value: boolean | string | null }) {
  const display = typeof value === "string" ? value : value === true ? "Yes" : value === false ? "No" : "Not recorded";
  const state = value === true ? "yes" : value === false ? "no" : "unknown";
  return (
    <div>
      <dt>{label}</dt>
      <dd className={`capability-${state}`}>{display}</dd>
    </div>
  );
}
