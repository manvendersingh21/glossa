"use client";

import { useState, type FormEvent } from "react";
import "./route-planner.css";

interface RouteResult {
  route: { distanceMeters: number; durationSeconds: number; staticDurationSeconds: number; delaySeconds: number };
  signals: Array<{ cnn: string; name: string; timingKind: string }>;
  estimate: {
    likelySignalStops: [number, number];
    likelySignalDelaySeconds: [number, number];
    confidence: "low" | "medium";
    explanation: string;
  };
  departureTime: string;
}

function minutes(seconds: number): string {
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

function range(values: [number, number], singular: string, plural = `${singular}s`): string {
  const unit = values[0] === values[1] ? singular : plural;
  return values[0] === values[1] ? `${values[0]} ${unit}` : `${values[0]}–${values[1]} ${plural}`;
}

function formatDeparture(value: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function localDateTimeValue(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function RoutePlanner() {
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [departureTime, setDepartureTime] = useState("");
  const [result, setResult] = useState<RouteResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const selectedDeparture = departureTime ? new Date(departureTime) : null;
      if (selectedDeparture && Number.isNaN(selectedDeparture.getTime())) throw new Error("Choose a valid departure time.");
      if (selectedDeparture && selectedDeparture.getTime() <= Date.now()) throw new Error("Departure time must be in the future.");
      const response = await fetch("/api/v1/route/estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          origin: { address: origin },
          destination: { address: destination },
          ...(selectedDeparture ? { departureTime: selectedDeparture.toISOString() } : {}),
        }),
      });
      const body = (await response.json()) as { error?: { message?: string } } & Partial<RouteResult>;
      if (!response.ok) throw new Error(body.error?.message ?? "The route could not be calculated.");
      setResult(body as RouteResult);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The route could not be calculated.");
    } finally {
      setLoading(false);
    }
  }

  function setDepartureIn(minutesFromNow: number) {
    setDepartureTime(localDateTimeValue(new Date(Date.now() + minutesFromNow * 60_000)));
  }

  return (
    <section className="route-planner" aria-labelledby="route-planner-heading">
      <div className="route-planner-header">
        <div>
          <p className="eyebrow">Signal-aware routing</p>
          <h2 id="route-planner-heading">Plan a lower-stop trip</h2>
        </div>
        <span className="route-planner-badge">SF beta</span>
      </div>
      <p className="route-planner-copy">Glossa combines live traffic-aware routing with San Francisco signal data to estimate where delay may happen.</p>
      <form className="route-form" onSubmit={submit}>
        <div className="route-form-fields">
          <div className="route-field"><label htmlFor="route-origin">From</label><input id="route-origin" value={origin} onChange={(event) => setOrigin(event.target.value)} placeholder="Origin address" required /></div>
          <div className="route-field"><label htmlFor="route-destination">To</label><input id="route-destination" value={destination} onChange={(event) => setDestination(event.target.value)} placeholder="Destination address" required /></div>
        </div>
        <div className="route-departure-row">
          <div className="route-field route-departure-field"><label htmlFor="route-departure">Leave</label><input id="route-departure" type="datetime-local" value={departureTime} onChange={(event) => setDepartureTime(event.target.value)} min={localDateTimeValue(new Date())} aria-describedby="route-departure-help" /><span id="route-departure-help" className="route-field-help">Optional — blank means leave now</span></div>
          <div className="route-quick-times" aria-label="Quick departure times"><button type="button" onClick={() => setDepartureIn(0)}>Now</button><button type="button" onClick={() => setDepartureIn(15)}>+15 min</button><button type="button" onClick={() => setDepartureIn(30)}>+30 min</button></div>
        </div>
        <button className="route-submit" type="submit" disabled={loading}>{loading ? "Calculating route…" : "Estimate my trip"}</button>
      </form>
      {error ? <p className="route-error" role="alert">{error}</p> : null}
      {result ? (
        <div className="route-result" role="status" aria-live="polite">
          <div className="route-result-intro"><div><p className="route-result-kicker">Your trip estimate</p><h3>Leave {formatDeparture(result.departureTime)}</h3></div><span className={`route-confidence route-confidence-${result.estimate.confidence}`}>{result.estimate.confidence} confidence</span></div>
          <div className="route-result-grid">
            <div className="route-metric route-metric-primary"><small>Traffic-aware ETA</small><strong>{minutes(result.route.durationSeconds)}</strong><span>{result.route.delaySeconds > 0 ? `+${minutes(result.route.delaySeconds)} in traffic` : "No traffic delay detected"}</span></div>
            <div className="route-metric"><small>Likely signal stops</small><strong>{range(result.estimate.likelySignalStops, "stop")}</strong><span>Along {result.signals.length} signalized intersections</span></div>
            <div className="route-metric"><small>Estimated signal delay</small><strong>{range(result.estimate.likelySignalDelaySeconds, "second")}</strong><span>Modeled, not live phase data</span></div>
          </div>
          <div className="route-explanation"><span className="route-explanation-icon" aria-hidden="true">i</span><p><strong>How to read this:</strong> {result.estimate.explanation}</p></div>
          <div className="route-data-note"><span className="route-live-dot" aria-hidden="true" /><span><strong>Live:</strong> road traffic and ETA</span><span className="route-note-divider" aria-hidden="true" /><span><strong>Estimated:</strong> signal stops and delay</span></div>
        </div>
      ) : null}
    </section>
  );
}
