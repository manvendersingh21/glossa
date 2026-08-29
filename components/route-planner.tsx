"use client";

import { useRef, useState, type FormEvent } from "react";
import "./route-planner.css";
import { InfoIcon } from "./icons";
import type { Confidence, TimingKind } from "@/lib/contracts";
import { TIMING_COLORS, timingLabel } from "./dashboard-utils";

/** Matches the finalized `RouteEstimate` response from /api/v1/route/estimate.
 * Every field below is surfaced in the UI (geometry fields are consumed by the
 * map, which is outside this component's scope). */
interface RouteSignal {
  cnn: string;
  name: string;
  coordinates: [number, number];
  distanceMeters: number;
  timingKind: TimingKind;
  cycleSeconds: number | null;
  cycleRangeSeconds: [number, number] | null;
  confidence: Confidence;
  vehicleActuated: boolean | null;
  pedestrianActuated: boolean | null;
  transitPriority: boolean | null;
}

/** One ranked departure alternative, bound from the server recommendation. */
interface RankedAlternative {
  departureTime: string;
  scoreSeconds: number;
  scoreRangeSeconds: [number, number];
  trafficDelaySeconds: number;
  signalDelaySeconds: [number, number];
  likelySignalStops: [number, number];
  recommended: boolean;
}

/** Server recommendation (canonical). Honesty floor applied server-side. */
interface RouteRecommendation {
  recommendedDepartureTime: string;
  scoreSeconds: number;
  scoreRangeSeconds: [number, number];
  trafficDelaySeconds: number;
  signalDelaySeconds: [number, number];
  likelySignalStops: [number, number];
  confidence: Confidence;
  explanation: string;
  rankedAlternatives: RankedAlternative[];
  candidatesConsidered: number;
}

interface RouteEstimate {
  route: {
    distanceMeters: number;
    durationSeconds: number;
    staticDurationSeconds: number;
    delaySeconds: number;
    encodedPolyline: string;
  };
  signals: RouteSignal[];
  estimate: {
    expectedSignalStops?: number;
    likelySignalStops: [number, number];
    expectedSignalDelaySeconds?: number;
    likelySignalDelaySeconds: [number, number];
    confidence: Confidence;
    explanation: string;
    rationale?: string;
    modeledSignals?: number;
    unknownSignals?: number;
  };
  recommendation: RouteRecommendation;
  /** Recommended departure instant (backwards-compatible). */
  departureTime: string;
}

/** A ranked departure alternative prepared for display. The scoring/range fields
 * are bound directly from the server recommendation (no client-side recompute). */
interface Candidate {
  iso: string;
  label: string;
  /** Live ETA from the server route estimate; only the recommended candidate carries one. */
  etaSeconds: number | undefined;
  /** Server: trafficDelaySeconds (live traffic delay). */
  trafficDelaySeconds: number;
  /** Server: signalDelaySeconds (modeled range). */
  signalDelaySeconds: [number, number];
  /** Server: likelySignalStops (modeled range, or null). */
  likelySignalStops: [number, number] | null;
  /** Server: scoreSeconds (expected total delay). */
  scoreSeconds: number;
  /** Server: scoreRangeSeconds (delay bounds). */
  scoreRangeSeconds: [number, number];
  estimate: RouteEstimate | undefined;
  recommended: boolean;
}

interface Comparison {
  recommendedLabel: string;
  savingsLabel: string;
  isRecommendationWin: boolean;
  /** Ranked alternatives (best first), from the server recommendation. */
  candidates: Candidate[];
  /** The server recommendation object. */
  recommendation: RouteRecommendation;
  /** Recommendation explanation (honesty + uncertainty narrative). */
  uncertainty: string;
}

type Phase = "idle" | "estimating" | "comparing";

const EXAMPLE_TRIPS: Array<{ from: string; to: string }> = [
  { from: "Ferry Building, Embarcadero, San Francisco", to: "Golden Gate Park, San Francisco" },
  { from: "Mission St & 1st St, San Francisco", to: "Mission St & 16th St, San Francisco" },
  { from: "Oracle Park, San Francisco", to: "Painted Ladies, Steiner St, San Francisco" },
];

function minutes(seconds: number): string {
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

function range(values: readonly [number, number], singular: string, plural = `${singular}s`): string {
  if (values[0] === values[1]) return `${values[0]} ${singular}`;
  return `${values[0]}–${values[1]} ${plural}`;
}

function miles(meters: number): string {
  return `${(meters / 1609.34).toFixed(1)} mi`;
}

function clock(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

/** Label for a ranked departure candidate. The earliest candidate (~now) is "Now";
 * all others show their clock time. compared-to is the earliest candidate's ISO. */
function candidateLabel(iso: string, earliestIso: string): string {
  return Math.abs(new Date(iso).getTime() - new Date(earliestIso).getTime()) < 60_000 ? "Now" : clock(iso);
}

function localDateTimeValue(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

/** Cycle timing for a single signal, using the finalized per-signal fields. */
function signalCycle(signal: RouteSignal): string {
  if (signal.cycleSeconds !== null) return `${signal.cycleSeconds}s cycle`;
  if (signal.cycleRangeSeconds) return `${signal.cycleRangeSeconds[0]}–${signal.cycleRangeSeconds[1]}s cycle`;
  return "Cycle not published";
}

function confidenceLabel(confidence: Confidence): string {
  return confidence === "unknown" ? "Confidence unknown" : `${confidence} conf.`;
}

async function fetchEstimate(
  origin: string,
  destination: string,
  departureTime: string | undefined,
  signal: AbortSignal,
): Promise<RouteEstimate> {
  const response = await fetch("/api/v1/route/estimate", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      origin: { address: origin },
      destination: { address: destination },
      ...(departureTime ? { departureTime } : {}),
    }),
    signal,
  });
  const body = (await response.json()) as { error?: { message?: string } } & Partial<RouteEstimate>;
  if (!response.ok) throw new Error(body.error?.message ?? "The route could not be calculated.");
  return body as RouteEstimate;
}

export function RoutePlanner() {
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [departureTime, setDepartureTime] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [trip, setTrip] = useState<RouteEstimate | null>(null);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exampleIndex, setExampleIndex] = useState(0);
  const [routeKey, setRouteKey] = useState<{ from: string; to: string }>({ from: "", to: "" });
  const abortRef = useRef<AbortController | null>(null);

  function loadExample() {
    const example = EXAMPLE_TRIPS[exampleIndex % EXAMPLE_TRIPS.length];
    setOrigin(example.from);
    setDestination(example.to);
    setExampleIndex((index) => index + 1);
    setError(null);
    setTrip(null);
    setComparison(null);
    setRouteKey({ from: "", to: "" });
  }

  function setDepartureIn(minsFromNow: number) {
    if (minsFromNow <= 0) {
      setDepartureTime("");
      return;
    }
    setDepartureTime(localDateTimeValue(new Date(Date.now() + minsFromNow * 60_000)));
  }

  function resolveDepartureIso(): string | undefined {
    if (!departureTime) return undefined;
    const selected = new Date(departureTime);
    if (Number.isNaN(selected.getTime())) return undefined;
    // The routes API requires a future departure; nudge slightly-past picks forward.
    if (selected.getTime() < Date.now() + 60_000) selected.setTime(Date.now() + 90_000);
    return selected.toISOString();
  }

  function validateInputs(): string | null {
    if (!origin.trim() || !destination.trim()) return "Enter an origin and a destination.";
    if (origin.trim().toLowerCase() === destination.trim().toLowerCase()) {
      return "Origin and destination need to be different.";
    }
    return null;
  }

  async function findBestTime(event?: FormEvent) {
    event?.preventDefault();
    const validationError = validateInputs();
    if (validationError) {
      setError(validationError);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const from = origin.trim();
    const to = destination.trim();

    setPhase("comparing");
    setError(null);
    setTrip(null);
    setComparison(null);
    setRouteKey({ from, to });

    try {
      // A single request lets the server evaluate nearby departure candidates
      // (capped Google calls) and return the recommendation. The UI consumes the
      // server recommendation instead of re-issuing one request per candidate,
      // which would multiply Google Routes calls.
      const estimate = await fetchEstimate(from, to, undefined, controller.signal);
      if (abortRef.current !== controller) return;

      const rec = estimate.recommendation;
      // Ranked alternatives best-first; the earliest candidate (~now) is the baseline.
      const ranked = [...rec.rankedAlternatives].sort(
        (a, b) => a.scoreSeconds - b.scoreSeconds || a.departureTime.localeCompare(b.departureTime),
      );
      const earliestIso = [...ranked].sort((a, b) => a.departureTime.localeCompare(b.departureTime))[0]?.departureTime ?? rec.recommendedDepartureTime;

      const candidates: Candidate[] = ranked.map((alt) => {
        const isRecommended = alt.recommended || alt.departureTime === rec.recommendedDepartureTime;
        return {
          iso: alt.departureTime,
          label: candidateLabel(alt.departureTime, earliestIso),
          // Only the recommended candidate has a route ETA; others are scored by expected delay.
          etaSeconds: isRecommended ? estimate.route.durationSeconds : undefined,
          trafficDelaySeconds: alt.trafficDelaySeconds,
          signalDelaySeconds: [alt.signalDelaySeconds[0], alt.signalDelaySeconds[1]],
          likelySignalStops: [alt.likelySignalStops[0], alt.likelySignalStops[1]],
          scoreSeconds: alt.scoreSeconds,
          scoreRangeSeconds: [alt.scoreRangeSeconds[0], alt.scoreRangeSeconds[1]],
          estimate: isRecommended ? estimate : undefined,
          recommended: isRecommended,
        };
      });

      const baseline = candidates.find((candidate) => candidate.iso === earliestIso) ?? candidates[0];
      const recommended = candidates.find((candidate) => candidate.recommended) ?? baseline;
      const savingsSeconds = Math.max(0, baseline.scoreSeconds - recommended.scoreSeconds);
      const sameAsBaseline = recommended.iso === baseline.iso;
      const recommendedLabel = recommended.label === "Now" ? "Leave now" : `Leave at ${recommended.label}`;
      const savingsLabel = sameAsBaseline
        ? "Leaving now is already your best option"
        : `About ${Math.max(1, Math.round(savingsSeconds / 60))} min less delay than leaving now`;

      setComparison({
        recommendedLabel,
        savingsLabel,
        isRecommendationWin: !sameAsBaseline,
        candidates,
        recommendation: rec,
        uncertainty: rec.explanation,
      });
      setTrip(estimate);
      setDepartureTime(localDateTimeValue(new Date(recommended.iso)));
    } catch (requestError) {
      if (abortRef.current !== controller) return;
      const message = requestError instanceof Error ? requestError.message : "The route could not be calculated.";
      setError(message);
    } finally {
      if (abortRef.current === controller) setPhase("idle");
    }
  }

  async function estimateForTime() {
    const validationError = validateInputs();
    if (validationError) {
      setError(validationError);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const from = origin.trim();
    const to = destination.trim();

    setPhase("estimating");
    setError(null);
    setTrip(null);
    setComparison(null);
    setRouteKey({ from, to });

    try {
      const iso = resolveDepartureIso();
      const estimate = await fetchEstimate(from, to, iso, controller.signal);
      if (abortRef.current !== controller) return;
      setTrip(estimate);
      setDepartureTime(localDateTimeValue(new Date(estimate.departureTime)));
    } catch (requestError) {
      if (abortRef.current !== controller) return;
      setError(requestError instanceof Error ? requestError.message : "The route could not be calculated.");
    } finally {
      if (abortRef.current === controller) setPhase("idle");
    }
  }

  const summaryText = trip
    ? `${comparison ? `${comparison.recommendedLabel}. ` : ""}Traffic-aware ETA ${minutes(trip.route.durationSeconds)}. Expected ${range(trip.estimate.likelySignalStops, "stop")} and ${range(trip.estimate.likelySignalDelaySeconds, "second")} of modeled signal delay. Signal stops and delay are estimates, not live controller state. ${trip.estimate.confidence} confidence.`
    : phase === "comparing"
      ? "Comparing departure times to find the best moment to leave."
      : phase === "estimating"
        ? "Calculating your trip."
        : "";

  return (
    <section className="route-planner" aria-labelledby="route-planner-heading">
      <div className="rp-header">
        <div className="rp-header-titles">
          <p className="eyebrow">Signal-aware routing</p>
          <h2 id="route-planner-heading">Plan a lower-stop trip</h2>
        </div>
        <span className="rp-badge" aria-label="San Francisco beta feature">SF beta</span>
      </div>
      <p className="rp-copy">
        {"Live traffic-aware timing meets San Francisco signal data. We estimate the stops and delay you may hit, and the best moment to leave."}
      </p>

      <form className="rp-form" onSubmit={findBestTime}>
        <div className="rp-fields">
          <div className="rp-field">
            <label htmlFor="route-origin">From</label>
            <input
              id="route-origin"
              value={origin}
              onChange={(event) => setOrigin(event.target.value)}
              placeholder="Origin address"
              required
              autoComplete="off"
            />
          </div>
          <div className="rp-field">
            <label htmlFor="route-destination">To</label>
            <input
              id="route-destination"
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
              placeholder="Destination address"
              required
              autoComplete="off"
            />
          </div>
        </div>

        <button type="button" className="rp-example" onClick={loadExample}>
          {origin || destination ? "Try another example trip" : "Try an example trip"}
        </button>

        <div className="rp-primary-row">
          <button type="submit" className="rp-submit" disabled={phase !== "idle"}>
            {phase === "comparing" ? "Comparing departure times…" : phase === "estimating" ? "Calculating…" : "Find best time to leave"}
          </button>
          <p className="rp-primary-help">
            {"Compares nearby departure times on the server and picks the lowest-delay one. One request — Google calls are capped."}
          </p>
        </div>

        <div className="rp-or" aria-hidden="true"><span>or pick an exact time</span></div>

        <div className="rp-exact-row">
          <div className="rp-field rp-departure-field">
            <label htmlFor="route-departure">Leave at</label>
            <input
              id="route-departure"
              type="datetime-local"
              value={departureTime}
              onChange={(event) => setDepartureTime(event.target.value)}
              min={localDateTimeValue(new Date())}
              aria-describedby="route-departure-help"
            />
            <span id="route-departure-help" className="rp-field-help">Blank means leave now.</span>
          </div>
          <div className="rp-quick-times" role="group" aria-label="Quick departure times">
            <button type="button" onClick={() => setDepartureIn(0)}>Now</button>
            <button type="button" onClick={() => setDepartureIn(15)}>+15</button>
            <button type="button" onClick={() => setDepartureIn(30)}>+30</button>
          </div>
        </div>
        <button type="button" className="rp-secondary" onClick={estimateForTime} disabled={phase !== "idle"}>
          Estimate for this time
        </button>
      </form>

      {error ? <p className="rp-error" role="alert">{error}</p> : null}

      <div className="rp-results" aria-busy={phase !== "idle"}>
        <p className="sr-only" role="status" aria-live="polite">{summaryText}</p>
        {phase !== "idle" ? <Skeleton /> : null}
        {comparison ? <Recommendation comparison={comparison} /> : null}
        {trip ? <TripDetail trip={trip} from={routeKey.from} to={routeKey.to} recommended={Boolean(comparison)} /> : null}
      </div>
    </section>
  );
}

function Skeleton() {
  return (
    <div className="rp-skeleton" aria-hidden="true">
      <div className="rp-skeleton-bar rp-skeleton-tall" />
      <div className="rp-skeleton-row">
        <div className="rp-skeleton-bar" />
        <div className="rp-skeleton-bar" />
      </div>
    </div>
  );
}

function Recommendation({ comparison }: { comparison: Comparison }) {
  const rec = comparison.recommendation;
  return (
    <section className="rp-rec" aria-labelledby="rp-rec-heading">
      <div className="rp-rec-head">
        <div>
          <p className="rp-rec-kicker">Best time to leave · {rec.candidatesConsidered} departures compared</p>
          <h3 id="rp-rec-heading" className="rp-rec-time">{comparison.recommendedLabel}</h3>
        </div>
        <span className={`rp-savings ${comparison.isRecommendationWin ? "rp-savings-win" : "rp-savings-flat"}`}>
          {comparison.savingsLabel}
        </span>
      </div>

      {rec ? (
        <dl className="rp-why" aria-label="Why this departure time is recommended">
          <div className="rp-why-row">
            <dt>Expected delay <span className="rp-why-sub">expected-delay score</span></dt>
            <dd>
              <strong>{minutes(rec.scoreSeconds)}</strong>
              <span className="rp-why-range">
                range {minutes(rec.scoreRangeSeconds[0])}–{minutes(rec.scoreRangeSeconds[1])}
              </span>
            </dd>
          </div>
          <div className="rp-why-row">
            <dt>
              <span className="rp-why-chip rp-why-live" aria-label="Live">Live</span>
              Traffic delay
            </dt>
            <dd>{minutes(rec.trafficDelaySeconds)}</dd>
          </div>
          <div className="rp-why-row">
            <dt>
              <span className="rp-why-chip rp-why-est" aria-label="Estimated">Est.</span>
              Signal delay
            </dt>
            <dd>{range(rec.signalDelaySeconds, "second")}</dd>
          </div>
          <div className="rp-why-row">
            <dt>
              <span className="rp-why-chip rp-why-est" aria-label="Estimated">Est.</span>
              Likely signal stops
            </dt>
            <dd>{rec.likelySignalStops ? range(rec.likelySignalStops, "stop") : "—"}</dd>
          </div>
        </dl>
      ) : null}

      <p className="rp-compare-heading" aria-hidden="true">Ranked alternatives</p>
      <ul className="rp-compare" aria-label="Ranked departure alternatives">
        {comparison.candidates.map((candidate) => (
          <li key={candidate.iso} className={`rp-compare-item ${candidate.recommended ? "is-best" : ""}`}>
            <span className="rp-compare-time">
              {candidate.recommended ? <span className="rp-best-tag" aria-label="Best option">Best</span> : null}
              <span className="rp-compare-label">{candidate.label}</span>
            </span>
            <span className="rp-compare-meta">
              {candidate.etaSeconds !== undefined ? (
                <span className="rp-compare-eta">ETA {minutes(candidate.etaSeconds)}</span>
              ) : null}
              <span className="rp-compare-delay">
                {candidate.scoreSeconds >= 60
                  ? `~${Math.round(candidate.scoreSeconds / 60)} min expected delay`
                  : "Minimal expected delay"}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <p className="rp-rec-note">
        <InfoIcon />
        <span>
          Lowest expected delay wins. Signal delay is modeled, not live. {comparison.uncertainty}
        </span>
      </p>
    </section>
  );
}

function TripDetail({
  trip,
  from,
  to,
  recommended,
}: {
  trip: RouteEstimate;
  from: string;
  to: string;
  recommended: boolean;
}) {
  const confidence = trip.estimate.confidence;
  const signals = trip.signals.length;
  return (
    <section className="rp-trip" aria-labelledby="rp-trip-heading">
      <div className="rp-trip-head">
        <div className="rp-trip-title">
          <p className="rp-trip-kicker">{recommended ? "Recommended trip" : "Your trip estimate"}</p>
          <h3 id="rp-trip-heading">
            {minutes(trip.route.durationSeconds)} <span>traffic-aware ETA</span>
          </h3>
          <p className="rp-trip-route">
            <strong>{from || "Origin"}</strong>
            <span aria-hidden="true"> → </span>
            <strong>{to || "destination"}</strong>
          </p>
        </div>
        <span className={`rp-confidence rp-confidence-${confidence}`} aria-label={`${confidence} confidence`}>
          {confidence} confidence
        </span>
      </div>

      <div className="rp-metric-primary">
        <div className="rp-metric-head">
          <small>Traffic-aware ETA</small>
          <span className="rp-live-chip" aria-label="Live data"><span className="rp-chip-dot" aria-hidden="true" />Live</span>
        </div>
        <strong>{minutes(trip.route.durationSeconds)}</strong>
        <span className="rp-eta-detail">
          {miles(trip.route.distanceMeters)}
          {trip.route.delaySeconds > 0 ? ` · +${minutes(trip.route.delaySeconds)} in traffic` : " · no traffic delay"}
        </span>
        <span className="rp-freeflow">Free-flow {minutes(trip.route.staticDurationSeconds)} without traffic</span>
      </div>

      <div className="rp-metric-row">
        <div className="rp-metric">
          <div className="rp-metric-head">
            <small>Expected signal stops</small>
            <span className="rp-est-chip" aria-label="Estimated, not live">Est.</span>
          </div>
          <strong>{range(trip.estimate.likelySignalStops, "stop")}</strong>
          <span>Across {signals} signalized {signals === 1 ? "intersection" : "intersections"} · modeled, not live</span>
        </div>
        <div className="rp-metric">
          <div className="rp-metric-head">
            <small>Expected signal delay</small>
            <span className="rp-est-chip" aria-label="Estimated, not live">Est.</span>
          </div>
          <strong>{range(trip.estimate.likelySignalDelaySeconds, "second")}</strong>
          <span>Modeled, not live phase data</span>
        </div>
      </div>

      <div className="rp-explanation">
        <InfoIcon />
        <p><strong>How to read this:</strong> {trip.estimate.explanation}</p>
      </div>

      {trip.signals.length > 0 ? (
        <details className="rp-signals">
          <summary>
            <span className="rp-signals-label">Signalized intersections on this route</span>
            <span className="rp-signals-count" aria-label={`${signals} signalized intersections`}>{signals}</span>
          </summary>
          <ol className="rp-signal-list">
            {trip.signals.map((signal) => {
              const hasCapability = signal.vehicleActuated || signal.pedestrianActuated || signal.transitPriority;
              return (
                <li key={signal.cnn} className="rp-signal-item">
                  <span className="rp-signal-main">
                    <span
                      className="rp-timing-swatch"
                      style={{ background: TIMING_COLORS[signal.timingKind] }}
                      aria-hidden="true"
                    />
                    <span className="rp-signal-name">{signal.name}</span>
                  </span>
                  <span className="rp-signal-meta">
                    <span className="rp-signal-timing">{timingLabel(signal.timingKind)}</span>
                    <span className="rp-signal-cycle">{signalCycle(signal)}</span>
                  </span>
                  <span className="rp-signal-tags">
                    <span className={`rp-signal-conf rp-signal-conf-${signal.confidence}`}>
                      {confidenceLabel(signal.confidence)}
                    </span>
                    {hasCapability ? (
                      <span className="rp-cap-list">
                        {signal.vehicleActuated ? <span className="rp-cap">Actuated</span> : null}
                        {signal.pedestrianActuated ? <span className="rp-cap">Ped</span> : null}
                        {signal.transitPriority ? <span className="rp-cap">Transit</span> : null}
                      </span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ol>
          <p className="rp-signals-note">
            Timing labels show provenance, not live phases. A signal&apos;s red/green state changes with detection,
            transit priority, and call buttons — Glossa never presents those as live facts.
          </p>
        </details>
      ) : null}

      <ul className="rp-legend" aria-label="Data freshness">
        <li>
          <span className="rp-live-dot" aria-hidden="true" />
          <span><strong>Live:</strong> traffic &amp; ETA from routing</span>
        </li>
        <li>
          <span className="rp-est-dot" aria-hidden="true" />
          <span><strong>Estimated:</strong> signal stops &amp; delay — modeled from dated inventory, not a live red/green phase reading.</span>
        </li>
      </ul>
    </section>
  );
}
