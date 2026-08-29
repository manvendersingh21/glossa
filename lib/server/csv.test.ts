import { describe, expect, it } from "vitest";

import type { SignalFeature } from "@/lib/contracts";
import { signalsToCsv } from "@/lib/server/csv";

function feature(overrides: Partial<SignalFeature["properties"]> = {}): SignalFeature {
  return {
    type: "Feature",
    id: "1001",
    geometry: { type: "Point", coordinates: [-122.4, 37.78] },
    properties: {
      id: "1001",
      cnn: "1001",
      signalNumber: null,
      name: "Market, \"Main\"",
      downtown: true,
      type: null,
      detection: null,
      vehicleActuated: null,
      pedestrianSignal: true,
      pedestrianActuated: false,
      accessiblePedestrianSignal: null,
      transitPriority: null,
      emergencyPreemption: null,
      redLightCamera: false,
      osmComponentCount: 4,
      timing: {
        kind: "modeled",
        cycleSeconds: 90,
        cycleRangeSeconds: [80, 100],
        cyclesPerHourRange: [36, 45],
        confidence: "low",
        modelVersion: "v1",
        rationale: ["weekday assumption", "not live"],
        sourceUrl: null,
        sourceAsOf: null,
      },
      inventoryAsOf: "2026-08-01T00:00:00.000Z",
      osmAsOf: null,
      ...overrides,
    },
  };
}

describe("signalsToCsv", () => {
  it("uses RFC 4180 line endings and escapes quotes and commas", () => {
    const csv = signalsToCsv([feature()]);
    expect(csv).toContain('"Market, ""Main"""');
    expect(csv).toContain("weekday assumption | not live");
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.split("\r\n")).toHaveLength(3);
  });

  it("does not serialize null as a literal and neutralizes spreadsheet formulas", () => {
    const csv = signalsToCsv([feature({ name: "=2+2" })]);
    expect(csv).toContain(",'=2+2,");
    expect(csv).not.toContain(",null,");
    expect(csv).not.toContain(",undefined,");
  });
});

