import { describe, expect, it } from "vitest";
import { estimateSignalDelay } from "@/lib/server/signal-model";

describe("signal delay model", () => {
  it("uses a fixed cycle, offset, and green window deterministically", () => {
    const result = estimateSignalDelay({
      arrivalSeconds: [10, 40],
      signals: [
        { cnn: "green", timing: { timingKind: "current_official", cycleSeconds: 90, offsetSeconds: 0, greenWindows: [{ startSeconds: 0, endSeconds: 30 }] } },
        { cnn: "red", timing: { timingKind: "current_official", cycleSeconds: 90, offsetSeconds: 0, greenWindows: [{ startSeconds: 0, endSeconds: 30 }] } },
      ],
    });

    expect(result.expectedStops).toBe(1);
    expect(result.expectedDelaySeconds).toBe(50);
    expect(result.likelySignalStops).toEqual([1, 1]);
    expect(result.confidence).toBe("high");
  });

  it("widens stale and unknown estimates without claiming live timing", () => {
    const result = estimateSignalDelay({
      signals: [
        { timing: { timingKind: "stale_official", cycleSeconds: 90 } },
        { timing: { timingKind: "unknown" } },
      ],
    });

    expect(result.unknownSignals).toBe(1);
    expect(result.confidence).toBe("low");
    expect(result.likelySignalStops[1]).toBeGreaterThanOrEqual(2);
    expect(result.rationale).toContain("remain unknown");
  });

  it("accounts for actuation as additional uncertainty", () => {
    const fixed = estimateSignalDelay({
      arrivalSeconds: [45],
      signals: [{ timing: { timingKind: "current_official", cycleSeconds: 90, greenWindows: [{ startSeconds: 0, endSeconds: 30 }] } }],
    });
    const actuated = estimateSignalDelay({
      arrivalSeconds: [45],
      signals: [{ timing: { timingKind: "current_official", cycleSeconds: 90, greenWindows: [{ startSeconds: 0, endSeconds: 30 }], vehicleActuated: true } }],
    });

    expect(actuated.likelySignalDelaySeconds[1]).toBeGreaterThan(fixed.likelySignalDelaySeconds[1]);
    expect(actuated.rationale).toContain("Actuation");
  });

  it("returns a zero, high-confidence result for an empty route", () => {
    expect(estimateSignalDelay({ signals: [] })).toEqual({
      expectedStops: 0,
      likelySignalStops: [0, 0],
      expectedDelaySeconds: 0,
      likelySignalDelaySeconds: [0, 0],
      confidence: "high",
      rationale: "No signalized intersections were supplied for this route.",
      modeledSignals: 0,
      unknownSignals: 0,
    });
  });
});
