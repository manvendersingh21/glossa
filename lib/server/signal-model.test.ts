import { describe, expect, it } from "vitest";
import { estimateSignalDelay, type SignalDelayModelInput } from "@/lib/server/signal-model";

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

  it("is a pure function: identical inputs always produce identical output", () => {
    const input: SignalDelayModelInput = {
      arrivalSeconds: [10, 45, 80],
      departureTime: "2026-08-29T12:00:00-07:00",
      signals: [
        { timing: { timingKind: "current_official", cycleSeconds: 90, offsetSeconds: 0, greenWindows: [{ startSeconds: 0, endSeconds: 30 }] } },
        { timing: { timingKind: "stale_official", cycleSeconds: 120, greenWindows: [{ startSeconds: 40, endSeconds: 70 }], transitPriority: true } },
        { timing: { timingKind: "unknown" } },
      ],
    };
    expect(estimateSignalDelay(input)).toEqual(estimateSignalDelay(input));
  });
});

describe("cycle, offset, and green-window evaluation", () => {
  it("waits until the next green window even when it does not start at phase 0", () => {
    // Cycle 100, green window [40, 70). Arrival at phase 50 is green; arrival at
    // phase 80 is red and must wait until phase 40 of the *next* cycle, i.e.
    // 100 - 80 + 40 = 60 seconds. The naive "cycle - phase" formula would
    // wrongly report 20.
    const result = estimateSignalDelay({
      arrivalSeconds: [50, 80],
      signals: [
        { timing: { timingKind: "current_official", cycleSeconds: 100, offsetSeconds: 0, greenWindows: [{ startSeconds: 40, endSeconds: 70 }] } },
        { timing: { timingKind: "current_official", cycleSeconds: 100, offsetSeconds: 0, greenWindows: [{ startSeconds: 40, endSeconds: 70 }] } },
      ],
    });

    expect(result.expectedStops).toBe(1);
    expect(result.expectedDelaySeconds).toBe(60);
    expect(result.likelySignalStops).toEqual([1, 1]);
    expect(result.likelySignalDelaySeconds).toEqual([60, 60]);
    expect(result.confidence).toBe("high");
  });

  it("applies the offset to decide whether an arrival is green or red", () => {
    const green = estimateSignalDelay({
      arrivalSeconds: [40],
      signals: [{ timing: { timingKind: "current_official", cycleSeconds: 90, offsetSeconds: 20, greenWindows: [{ startSeconds: 0, endSeconds: 30 }] } }],
    });
    const red = estimateSignalDelay({
      arrivalSeconds: [40],
      signals: [{ timing: { timingKind: "current_official", cycleSeconds: 90, offsetSeconds: 0, greenWindows: [{ startSeconds: 0, endSeconds: 30 }] } }],
    });

    // Arrival 40 with offset 20 lands at phase 20 (green). With offset 0 it
    // lands at phase 40 (red), waiting 50 seconds to the next cycle start.
    expect(green.expectedStops).toBe(0);
    expect(green.expectedDelaySeconds).toBe(0);
    expect(green.likelySignalStops).toEqual([0, 0]);

    expect(red.expectedStops).toBe(1);
    expect(red.expectedDelaySeconds).toBe(50);
    expect(red.likelySignalStops).toEqual([1, 1]);
  });

  it("models a cycle-only signal probabilistically instead of a forced stop", () => {
    const result = estimateSignalDelay({
      arrivalSeconds: [1234],
      signals: [{ timing: { timingKind: "current_official", cycleSeconds: 90 } }],
    });

    // No movement windows -> green ratio defaults to 0.5, so the expected
    // red-time wait is cycle * (1 - g) / 2 = 22.5s with a half-stop expectation.
    expect(result.expectedStops).toBe(0.5);
    expect(result.expectedDelaySeconds).toBe(22.5);
    expect(result.likelySignalStops).toEqual([0, 1]);
    expect(result.likelySignalDelaySeconds).toEqual([22, 23]);
    expect(result.confidence).toBe("high");
  });

  it("derives arrival from distance and speed when arrivalSeconds is absent", () => {
    const result = estimateSignalDelay({
      routeSpeedMps: 2,
      signals: [
        { distanceMeters: 100, timing: { timingKind: "current_official", cycleSeconds: 90, greenWindows: [{ startSeconds: 0, endSeconds: 30 }] } },
      ],
    });

    // 100 m at 2 m/s = 50s arrival -> phase 50 is red -> waits 40s for the next green.
    expect(result.expectedStops).toBe(1);
    expect(result.expectedDelaySeconds).toBe(40);
  });

  it("falls back to a conservative unknown band when the cycle is unusable", () => {
    const zero = estimateSignalDelay({ signals: [{ timing: { timingKind: "current_official", cycleSeconds: 0 } }] });
    const negative = estimateSignalDelay({ signals: [{ timing: { timingKind: "current_official", cycleSeconds: -5 } }] });

    expect(zero.unknownSignals).toBe(1);
    expect(zero.confidence).toBe("low");
    expect(negative.unknownSignals).toBe(1);
    expect(negative.confidence).toBe("low");
  });
});

describe("time-of-day plan selection", () => {
  const plans = [
    { startMinute: 0, endMinute: 720, cycleSeconds: 100, offsetSeconds: 0, greenWindows: [{ startSeconds: 0, endSeconds: 40 }] },
    { startMinute: 720, endMinute: 1440, cycleSeconds: 120, offsetSeconds: 0, greenWindows: [{ startSeconds: 0, endSeconds: 40 }] },
  ];

  function signal() {
    return {
      timing: {
        timingKind: "current_official" as const,
        cycleSeconds: 90, // signal-level value is overridden by the selected plan
        timeOfDayPlans: plans,
      },
    };
  }

  it("selects the AM plan for a morning departure and PM plan for an afternoon one", () => {
    const morning = estimateSignalDelay({ arrivalSeconds: [50], departureTime: "2026-08-29T09:00:00-07:00", signals: [signal()] });
    const afternoon = estimateSignalDelay({ arrivalSeconds: [50], departureTime: "2026-08-29T13:00:00-07:00", signals: [signal()] });

    // Arrival at phase 50 with a [0, 40) green window is red in both plans.
    // AM (cycle 100): wait = 100 - 50 = 50. PM (cycle 120): wait = 120 - 50 = 70.
    expect(morning.expectedDelaySeconds).toBe(50);
    expect(afternoon.expectedDelaySeconds).toBe(70);
    expect(morning.likelySignalStops).toEqual([1, 1]);
    expect(afternoon.likelySignalStops).toEqual([1, 1]);
  });

  it("keeps a San Francisco local time stable regardless of host timezone encoding", () => {
    // 12:00 in SF carries offset -07:00; the model reads the wall-clock minute
    // directly so both encodings select the PM plan (minute 720).
    const offset = estimateSignalDelay({ arrivalSeconds: [50], departureTime: "2026-08-29T12:00:00-07:00", signals: [signal()] });
    const zulu = estimateSignalDelay({ arrivalSeconds: [50], departureTime: "2026-08-29T19:00:00Z", signals: [signal()] });

    expect(offset.expectedDelaySeconds).toBe(zulu.expectedDelaySeconds);
  });

  it("treats a departure with no covering time-of-day plan as unknown", () => {
    // 2026-08-29 is a Saturday (day 6). A Mon-Fri plan does not cover it, so the
    // signal is modeled conservatively as unknown for this departure even
    // though a signal-level cycle exists.
    const weekdayPlan = {
      startMinute: 0,
      endMinute: 1440,
      daysOfWeek: [1, 2, 3, 4, 5],
      cycleSeconds: 90,
      offsetSeconds: 0,
      greenWindows: [{ startSeconds: 0, endSeconds: 30 }],
    };
    const saturday = estimateSignalDelay({
      arrivalSeconds: [40],
      departureTime: "2026-08-29T12:00:00-07:00",
      signals: [{ timing: { timingKind: "current_official", cycleSeconds: 90, timeOfDayPlans: [weekdayPlan] } }],
    });
    // 2026-08-31 is a Monday (day 1) -> covered -> modeled with the plan.
    const monday = estimateSignalDelay({
      arrivalSeconds: [40],
      departureTime: "2026-08-31T12:00:00-07:00",
      signals: [{ timing: { timingKind: "current_official", cycleSeconds: 90, timeOfDayPlans: [weekdayPlan] } }],
    });

    expect(saturday.modeledSignals).toBe(0);
    expect(saturday.unknownSignals).toBe(1);
    expect(saturday.confidence).toBe("low");
    expect(saturday.rationale).toContain("no time-of-day plan covering the departure time");

    expect(monday.modeledSignals).toBe(1);
    expect(monday.unknownSignals).toBe(0);
    expect(monday.expectedStops).toBe(1);
    expect(monday.expectedDelaySeconds).toBe(50);
    expect(monday.confidence).toBe("high");
  });
});

describe("stale official evidence", () => {
  function base(staleAfter?: string, departureTime?: string) {
    return {
      arrivalSeconds: [45],
      departureTime,
      signals: [
        {
          timing: {
            timingKind: "current_official" as const,
            cycleSeconds: 90,
            offsetSeconds: 0,
            greenWindows: [{ startSeconds: 0, endSeconds: 30 }],
            staleAfter,
          },
        },
      ],
    };
  }

  it("keeps current_official evidence fresh when staleAfter has not passed", () => {
    const fresh = estimateSignalDelay(base());
    const future = estimateSignalDelay(base("2099-01-01", "2026-08-29T12:00:00-07:00"));

    expect(fresh.confidence).toBe("high");
    expect(fresh.likelySignalDelaySeconds).toEqual([45, 45]);
    expect(future.confidence).toBe("high");
    expect(future.likelySignalDelaySeconds).toEqual([45, 45]);
  });

  it("downgrades current_official to stale official once staleAfter passes the departure time", () => {
    const stale = estimateSignalDelay(base("2020-01-01", "2026-08-29T12:00:00-07:00"));

    expect(stale.confidence).toBe("medium");
    expect(stale.likelySignalDelaySeconds[0]).toBeLessThan(45);
    expect(stale.likelySignalDelaySeconds[1]).toBeGreaterThan(45);
    expect(stale.likelySignalDelaySeconds).toEqual([33, 57]);
  });

  it("does not reclassify when no departure time is supplied", () => {
    const result = estimateSignalDelay(base("2020-01-01"));
    expect(result.confidence).toBe("high");
    expect(result.likelySignalDelaySeconds).toEqual([45, 45]);
  });
});

describe("transit priority and emergency preemption", () => {
  function base() {
    return {
      arrivalSeconds: [45],
      signals: [
        {
          timing: {
            timingKind: "current_official" as const,
            cycleSeconds: 90,
            offsetSeconds: 0,
            greenWindows: [{ startSeconds: 0, endSeconds: 30 }],
          },
        },
      ],
    };
  }

  it("widens the band and lowers confidence when transit priority is possible", () => {
    const plain = estimateSignalDelay(base());
    const priority = estimateSignalDelay({
      arrivalSeconds: [45],
      signals: [{ timing: { timingKind: "current_official", cycleSeconds: 90, offsetSeconds: 0, greenWindows: [{ startSeconds: 0, endSeconds: 30 }], transitPriority: true } }],
    });

    expect(plain.confidence).toBe("high");
    expect(priority.confidence).toBe("medium");
    expect(priority.likelySignalDelaySeconds[0]).toBeLessThan(plain.likelySignalDelaySeconds[0]);
    expect(priority.likelySignalDelaySeconds[1]).toBeGreaterThan(plain.likelySignalDelaySeconds[1]);
    expect(priority.likelySignalDelaySeconds).toEqual([36, 59]);
    expect(priority.rationale).toContain("Transit priority");
  });

  it("widens the band beyond a single cycle when emergency preemption is possible", () => {
    const plain = estimateSignalDelay(base());
    const preempted = estimateSignalDelay({
      arrivalSeconds: [45],
      signals: [{ timing: { timingKind: "current_official", cycleSeconds: 90, offsetSeconds: 0, greenWindows: [{ startSeconds: 0, endSeconds: 30 }], emergencyPreemption: true } }],
    });

    expect(preempted.confidence).toBe("medium");
    // Band widens on both sides of the base 45s wait.
    expect(preempted.likelySignalDelaySeconds[0]).toBeLessThan(plain.likelySignalDelaySeconds[0]);
    expect(preempted.likelySignalDelaySeconds[1]).toBeGreaterThan(plain.likelySignalDelaySeconds[1]);
    // Preemption can cost nearly an extra cycle, so the upper bound exceeds
    // a single 90-second cycle.
    expect(preempted.likelySignalDelaySeconds[1]).toBeGreaterThan(90);
    expect(preempted.likelySignalDelaySeconds).toEqual([27, 93]);
    expect(preempted.rationale).toContain("Emergency preemption");
  });

  it("caps confidence at medium whenever any modeled signal can preempt or take priority", () => {
    const mixed = estimateSignalDelay({
      arrivalSeconds: [10, 45],
      signals: [
        { timing: { timingKind: "current_official", cycleSeconds: 90, greenWindows: [{ startSeconds: 0, endSeconds: 30 }] } },
        { timing: { timingKind: "current_official", cycleSeconds: 90, greenWindows: [{ startSeconds: 0, endSeconds: 30 }], emergencyPreemption: true } },
      ],
    });

    expect(mixed.confidence).toBe("medium");
  });
});

describe("aggregate confidence and rationale", () => {
  function signal(kind: "current_official" | "stale_official" | "unknown") {
    return { timing: { timingKind: kind, cycleSeconds: 90, greenWindows: [{ startSeconds: 0, endSeconds: 30 }] } };
  }

  it("is high only when every signal has current/observed timing and none is unknown", () => {
    const high = estimateSignalDelay({ arrivalSeconds: [45, 10], signals: [signal("current_official"), signal("current_official")] });
    expect(high.confidence).toBe("high");
  });

  it("is medium when the weakest admissible evidence is stale and nothing is unknown", () => {
    const medium = estimateSignalDelay({ arrivalSeconds: [45, 45], signals: [signal("current_official"), signal("stale_official")] });
    expect(medium.confidence).toBe("medium");
  });

  it("is low as soon as any signal is unknown", () => {
    const low = estimateSignalDelay({ arrivalSeconds: [45, 0], signals: [signal("current_official"), signal("unknown")] });
    expect(low.confidence).toBe("low");
  });
});
