import { describe, expect, it } from "vitest";
import { matchComponent } from "./matching";
import type { NormalizedIntersection, OsmSignalComponent } from "./types";

function intersection(
  cnn: string,
  coordinates: [number, number],
  normalizedStreets: string[],
): NormalizedIntersection {
  return {
    cnn,
    objectId: null,
    signalNumber: null,
    name: normalizedStreets.join(" & "),
    streetNames: normalizedStreets,
    normalizedStreets,
    type: null,
    detection: null,
    vehicleActuated: null,
    pedestrianSignal: null,
    pedestrianActuated: null,
    accessiblePedestrianSignal: null,
    transitPriority: null,
    emergencyPreemption: null,
    redLightCamera: null,
    coordinates,
    inventoryAsOf: null,
    dataLoadedAt: null,
    rawProperties: {},
  };
}

function component(
  coordinates: [number, number],
  normalizedStreets: string[],
): OsmSignalComponent {
  return {
    osmType: "node",
    osmId: 1,
    coordinates,
    tags: { highway: "traffic_signals" },
    nearbyStreets: normalizedStreets,
    normalizedStreets,
  };
}

describe("OSM component matching", () => {
  it("makes a high confidence many-to-one street/spatial match", () => {
    const intersections = [intersection("1000", [-122.4000, 37.7800], ["MARKET", "3RD"])];
    const result = matchComponent(component([-122.40002, 37.78001], ["3RD", "MARKET"]), intersections);
    expect(result.status).toBe("matched");
    expect(result.confidence).toBe("high");
    expect(result.intersectionCnn).toBe("1000");
    expect(result.streetOverlap).toBe(2);
  });

  it("retains close competing candidates as ambiguous", () => {
    const intersections = [
      intersection("1000", [-122.4001, 37.7800], ["MARKET", "3RD"]),
      intersection("2000", [-122.3999, 37.7800], ["MARKET", "4TH"]),
    ];
    const result = matchComponent(component([-122.4000, 37.7800], ["MARKET"]), intersections);
    expect(result.status).toBe("ambiguous");
    expect(result.intersectionCnn).toBeNull();
    expect(result.candidates).toHaveLength(2);
  });

  it("does not force a distant component onto an intersection", () => {
    const result = matchComponent(
      component([-122.41, 37.79], []),
      [intersection("1000", [-122.40, 37.78], ["MARKET", "3RD"])],
    );
    expect(result.status).toBe("unmatched");
    expect(result.confidence).toBe("unknown");
  });
});

