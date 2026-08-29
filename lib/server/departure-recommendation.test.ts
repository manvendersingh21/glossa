import { describe, expect, it } from "vitest";

import {
  generateCandidateDepartureTimes,
  recommendDeparture,
  scoreRouteOutcome,
  type RouteOutcome,
} from "@/lib/server/departure-recommendation";

const now = "2026-08-29T12:00:00-07:00";
const nowUtc = "2026-08-29T19:00:00.000Z";

describe("generateCandidateDepartureTimes", () => {
  it("defaults to now, +15, +30, +45, and +60 minutes as UTC ISO timestamps", () => {
    expect(generateCandidateDepartureTimes({ now: nowUtc })).toEqual([
      "2026-08-29T19:00:00.000Z",
      "2026-08-29T19:15:00.000Z",
      "2026-08-29T19:30:00.000Z",
      "2026-08-29T19:45:00.000Z",
      "2026-08-29T20:00:00.000Z",
    ]);
  });

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

  it("normalizes offset timestamps to UTC and accepts Date inputs", () => {
    const fromOffset = generateCandidateDepartureTimes({
      now: new Date("2026-08-29T12:00:00-07:00"),
      window: { start: "2026-08-29T15:00:00-04:00", durationMinutes: 0 },
    });
    // Both offsets resolve to 19:00Z.
    expect(fromOffset).toEqual(["2026-08-29T19:00:00.000Z"]);
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

  it("rejects an invalid timestamp and a non-positive interval", () => {
    expect(() => generateCandidateDepartureTimes({ now: "not-a-date" })).toThrow();
    expect(() => generateCandidateDepartureTimes({ now, intervalMinutes: 0 })).toThrow();
  });
});

describe("scoreRouteOutcome", () => {
  it("scores traffic plus mean modeled signal delay and preserves bounds", () => {
    const scored = scoreRouteOutcome({
      departureTime: now,
      trafficDelaySeconds: 120,
      modeledSignalDelaySeconds: [30, 90],
      likelySignalStops: [2, 4],
    });
    const { explanation, ...rest } = scored;
    expect(rest).toEqual({
      departureTime: nowUtc,
      trafficDelaySeconds: 120,
      modeledSignalDelaySeconds: [30, 90],
      likelySignalStops: [2, 4],
      expectedSignalStops: 3,
      scoreSeconds: 180,
      scoreRangeSeconds: [150, 210],
      confidence: "medium",
    });
    expect(explanation).toContain("~180s");
    expect(explanation).toContain("medium confidence");
    expect(explanation).toContain("Expected 3 signal stops");
    expect(explanation).toContain(nowUtc);
  });

  it("collapses a scalar signal delay into a point range and leaves stops optional", () => {
    const scored = scoreRouteOutcome({
      departureTime: nowUtc,
      trafficDelaySeconds: 75,
      modeledSignalDelaySeconds: 75,
    });
    const { explanation, ...rest } = scored;
    expect(rest).toEqual({
      departureTime: nowUtc,
      trafficDelaySeconds: 75,
      modeledSignalDelaySeconds: [75, 75],
      likelySignalStops: null,
      expectedSignalStops: null,
      scoreSeconds: 150,
      scoreRangeSeconds: [150, 150],
      confidence: "high",
    });
    expect(explanation).not.toContain("signal stops");
  });

  it("derives high confidence when the modeled range is narrow relative to the total", () => {
    expect(scoreRouteOutcome({
      departureTime: nowUtc,
      trafficDelaySeconds: 200,
      modeledSignalDelaySeconds: [85, 90],
    }).confidence).toBe("high");
  });

  it("derives low confidence when the modeled range dominates the total delay", () => {
    expect(scoreRouteOutcome({
      departureTime: nowUtc,
      trafficDelaySeconds: 10,
      modeledSignalDelaySeconds: [10, 200],
    }).confidence).toBe("low");
  });

  it("derives high confidence when there is no expected delay", () => {
    expect(scoreRouteOutcome({
      departureTime: nowUtc,
      trafficDelaySeconds: 0,
      modeledSignalDelaySeconds: [0, 0],
    }).confidence).toBe("high");
  });

  it("uses an explicitly supplied confidence instead of deriving it", () => {
    expect(scoreRouteOutcome({
      departureTime: nowUtc,
      trafficDelaySeconds: 200,
      modeledSignalDelaySeconds: [85, 90],
      confidence: "low",
    }).confidence).toBe("low");
  });

  it("rejects negative or malformed inputs", () => {
    expect(() => scoreRouteOutcome({ departureTime: nowUtc, trafficDelaySeconds: -1, modeledSignalDelaySeconds: 0 })).toThrow();
    expect(() => scoreRouteOutcome({ departureTime: nowUtc, trafficDelaySeconds: 0, modeledSignalDelaySeconds: [90, 30] })).toThrow();
    expect(() => scoreRouteOutcome({ departureTime: "nope", trafficDelaySeconds: 0, modeledSignalDelaySeconds: 0 })).toThrow();
  });
});

describe("recommendDeparture", () => {
  function outcomesAt(...entries: Array<[string, number, number | [number, number]]>): RouteOutcome[] {
    return entries.map(([departureTime, traffic, signal]) => ({
      departureTime,
      trafficDelaySeconds: traffic,
      modeledSignalDelaySeconds: signal,
    }));
  }

  it("chooses the lowest score and breaks ties by earliest departure", () => {
    const result = recommendDeparture({
      now,
      window: { durationMinutes: 30 },
      intervalMinutes: 15,
      outcomes: outcomesAt(
        ["2026-08-29T19:00:00Z", 120, 80],
        ["2026-08-29T19:15:00Z", 75, 75],
        ["2026-08-29T19:30:00Z", 75, 75],
      ),
    });
    expect(result.recommendation?.departureTime).toBe("2026-08-29T19:15:00.000Z");
    expect(result.scoredOutcomes).toHaveLength(3);
    expect(result.candidates).toEqual([
      "2026-08-29T19:00:00.000Z",
      "2026-08-29T19:15:00.000Z",
      "2026-08-29T19:30:00.000Z",
    ]);
    expect(result.uncertaintyExplanation).toContain("Traffic and signal behavior can vary");
  });

  it("breaks ties deterministically regardless of outcome input order", () => {
    const unordered = outcomesAt(
      ["2026-08-29T19:30:00Z", 75, 75],
      ["2026-08-29T19:00:00Z", 120, 80],
      ["2026-08-29T19:15:00Z", 75, 75],
    );
    const result = recommendDeparture({
      now,
      window: { durationMinutes: 30 },
      intervalMinutes: 15,
      outcomes: unordered,
    });
    expect(result.recommendation?.departureTime).toBe("2026-08-29T19:15:00.000Z");
  });

  it("returns a recommendation carrying best time, score, expected stops, delay range, confidence, and explanation", () => {
    const result = recommendDeparture({
      now,
      window: { durationMinutes: 30 },
      intervalMinutes: 15,
      outcomes: [
        { departureTime: "2026-08-29T19:00:00Z", trafficDelaySeconds: 120, modeledSignalDelaySeconds: [30, 90], likelySignalStops: [2, 4] },
        { departureTime: "2026-08-29T19:15:00Z", trafficDelaySeconds: 60, modeledSignalDelaySeconds: [20, 40], likelySignalStops: [1, 2] },
        { departureTime: "2026-08-29T19:30:00Z", trafficDelaySeconds: 90, modeledSignalDelaySeconds: [40, 60], likelySignalStops: [1, 3] },
      ],
    });
    const best = result.recommendation!;
    expect(best.departureTime).toBe("2026-08-29T19:15:00.000Z");
    expect(best.scoreSeconds).toBe(60 + 30);
    expect(best.scoreRangeSeconds).toEqual([80, 100]);
    expect(best.likelySignalStops).toEqual([1, 2]);
    expect(best.expectedSignalStops).toBe(1.5);
    expect(best.modeledSignalDelaySeconds).toEqual([20, 40]);
    expect(best.confidence).toBe("high");
    expect(best.explanation).toContain("~90s");
    expect(result.uncertaintyExplanation).toContain("Best departure is 2026-08-29T19:15:00.000Z");
  });

  it("combines Google traffic delay with modeled signal delay in the score", () => {
    const result = recommendDeparture({
      now,
      window: { durationMinutes: 0 },
      outcomes: [{ departureTime: now, trafficDelaySeconds: 110, modeledSignalDelaySeconds: [40, 60] }],
    });
    expect(result.recommendation?.trafficDelaySeconds).toBe(110);
    expect(result.recommendation?.modeledSignalDelaySeconds).toEqual([40, 60]);
    expect(result.recommendation?.scoreSeconds).toBe(110 + 50);
    expect(result.recommendation?.scoreRangeSeconds).toEqual([150, 170]);
  });

  it("ignores outcomes whose departure time is not a generated candidate", () => {
    const result = recommendDeparture({
      now,
      window: { durationMinutes: 30 },
      intervalMinutes: 15,
      outcomes: outcomesAt(
        ["2026-08-29T19:07:00Z", 1, 1],
        ["2026-08-29T19:15:00Z", 75, 75],
      ),
    });
    expect(result.scoredOutcomes).toHaveLength(1);
    expect(result.recommendation?.departureTime).toBe("2026-08-29T19:15:00.000Z");
  });

  it("returns no recommendation when candidate outcomes are missing", () => {
    const result = recommendDeparture({ now, outcomes: [] });
    expect(result.recommendation).toBeNull();
    expect(result.uncertaintyExplanation).toContain("No route outcomes");
  });

  it("returns no recommendation when no outcome matches the candidates", () => {
    const result = recommendDeparture({
      now,
      window: { durationMinutes: 30 },
      intervalMinutes: 15,
      outcomes: outcomesAt(["2026-08-29T20:00:00Z", 50, 50]),
    });
    expect(result.recommendation).toBeNull();
    expect(result.scoredOutcomes).toEqual([]);
  });

  it("returns scoredOutcomes ranked best-first with the recommendation as the head", () => {
    const result = recommendDeparture({
      now,
      window: { durationMinutes: 45 },
      intervalMinutes: 15,
      outcomes: outcomesAt(
        ["2026-08-29T19:00:00Z", 200, 0], // score 200
        ["2026-08-29T19:15:00Z", 80, 40], // score 120 (tied best)
        ["2026-08-29T19:45:00Z", 90, 30], // score 120 (tied best, later)
        ["2026-08-29T19:30:00Z", 50, 110], // score 160
      ),
    });
    // Best score first; ties broken by earliest departure (19:15 before 19:45).
    expect(result.scoredOutcomes.map((o) => o.departureTime)).toEqual([
      "2026-08-29T19:15:00.000Z",
      "2026-08-29T19:45:00.000Z",
      "2026-08-29T19:30:00.000Z",
      "2026-08-29T19:00:00.000Z",
    ]);
    expect(result.scoredOutcomes.map((o) => o.scoreSeconds)).toEqual([120, 120, 160, 200]);
    expect(result.recommendation).toBe(result.scoredOutcomes[0]);
  });
});
