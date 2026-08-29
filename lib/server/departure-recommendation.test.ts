import { describe, expect, it } from "vitest";

import {
  generateCandidateDepartureTimes,
  recommendDeparture,
  scoreRouteOutcome,
} from "@/lib/server/departure-recommendation";

const now = "2026-08-29T12:00:00-07:00";

describe("generateCandidateDepartureTimes", () => {
  it("generates inclusive, timezone-safe UTC ISO candidates", () => {
    expect(generateCandidateDepartureTimes({
      now,
      window: { start: now, durationMinutes: 30 },
      intervalMinutes: 15,
    })).toEqual([
      "2026-08-29T19:00:00.000Z",
      "2026-08-29T19:15:00.000Z",
      "2026-08-29T19:30:00.000Z",
    ]);
  });

  it("supports an explicit future end and an interval-aligned window", () => {
    expect(generateCandidateDepartureTimes({
      now,
      window: { start: "2026-08-29T19:05:00Z", end: "2026-08-29T19:35:00Z" },
      intervalMinutes: 15,
      includeStart: false,
    })).toEqual(["2026-08-29T19:20:00.000Z", "2026-08-29T19:35:00.000Z"]);
  });

  it("rejects a past start or reversed window", () => {
    expect(() => generateCandidateDepartureTimes({ now, window: { start: "2026-08-29T18:59:00Z" } })).toThrow();
    expect(() => generateCandidateDepartureTimes({ now, window: { start: now, end: "2026-08-29T11:00:00Z" } })).toThrow();
  });
});

describe("scoreRouteOutcome", () => {
  it("scores traffic plus mean modeled signal delay and preserves bounds", () => {
    expect(scoreRouteOutcome({
      departureTime: now,
      trafficDelaySeconds: 120,
      modeledSignalDelaySeconds: [30, 90],
      likelySignalStops: [2, 4],
    })).toEqual({
      departureTime: "2026-08-29T19:00:00.000Z",
      trafficDelaySeconds: 120,
      modeledSignalDelaySeconds: [30, 90],
      likelySignalStops: [2, 4],
      scoreSeconds: 180,
      scoreRangeSeconds: [150, 210],
    });
  });
});

describe("recommendDeparture", () => {
  it("chooses the lowest score and breaks ties by earliest departure", () => {
    const result = recommendDeparture({
      now,
      window: { durationMinutes: 30 },
      intervalMinutes: 15,
      outcomes: [
        { departureTime: "2026-08-29T19:00:00Z", trafficDelaySeconds: 120, modeledSignalDelaySeconds: 80 },
        { departureTime: "2026-08-29T19:15:00Z", trafficDelaySeconds: 75, modeledSignalDelaySeconds: 75 },
        { departureTime: "2026-08-29T19:30:00Z", trafficDelaySeconds: 75, modeledSignalDelaySeconds: 75 },
      ],
    });
    expect(result.recommendation?.departureTime).toBe("2026-08-29T19:15:00.000Z");
    expect(result.scoredOutcomes).toHaveLength(3);
    expect(result.uncertaintyExplanation).toContain("Traffic and signal behavior can vary");
  });

  it("returns no recommendation when candidate outcomes are missing", () => {
    const result = recommendDeparture({ now, outcomes: [] });
    expect(result.recommendation).toBeNull();
    expect(result.uncertaintyExplanation).toContain("No route outcomes");
  });
});
