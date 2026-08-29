import { describe, expect, it } from "vitest";
import type { SignalFeature, TimingKind } from "@/lib/contracts";
import { filterSignals, signalsApiUrl, type TimingFilter } from "./dashboard-utils";

function signal(
  id: string,
  kind: TimingKind,
  capabilities: Partial<SignalFeature["properties"]> = {},
): SignalFeature {
  return {
    type: "Feature",
    id,
    geometry: { type: "Point", coordinates: [-122.4, 37.78] },
    properties: {
      id,
      cnn: id,
      signalNumber: null,
      name: `Signal ${id}`,
      downtown: true,
      type: null,
      detection: null,
      vehicleActuated: null,
      pedestrianSignal: null,
      pedestrianActuated: null,
      accessiblePedestrianSignal: null,
      transitPriority: null,
      emergencyPreemption: null,
      redLightCamera: null,
      osmComponentCount: 0,
      timing: {
        kind,
        cycleSeconds: null,
        cycleRangeSeconds: null,
        cyclesPerHourRange: null,
        confidence: "unknown",
        modelVersion: null,
        rationale: [],
        sourceUrl: null,
        sourceAsOf: null,
      },
      inventoryAsOf: null,
      osmAsOf: null,
      ...capabilities,
    },
  };
}

describe("signalsApiUrl", () => {
  it("requests only the downtown subset for the downtown view", () => {
    expect(signalsApiUrl("downtown")).toBe("/api/v1/signals?limit=2000&downtown=true");
  });

  it("omits the downtown filter for the all-SF view", () => {
    expect(signalsApiUrl("sf")).toBe("/api/v1/signals?limit=2000");
  });
});

describe("filterSignals", () => {
  it("groups current and archived agency records under the official filter", () => {
    const features = [
      signal("one", "current_official"),
      signal("two", "stale_official"),
      signal("three", "modeled"),
    ];
    const filters = new Set<TimingFilter>(["official"]);
    expect(filterSignals(features, filters, "all").map(({ id }) => id)).toEqual(["one", "two"]);
  });

  it("requires an explicitly recorded capability", () => {
    const features = [
      signal("yes", "unknown", { transitPriority: true }),
      signal("no", "unknown", { transitPriority: false }),
      signal("unknown", "unknown", { transitPriority: null }),
    ];
    const filters = new Set<TimingFilter>(["unknown"]);
    expect(filterSignals(features, filters, "transitPriority").map(({ id }) => id)).toEqual([
      "yes",
    ]);
  });
});
