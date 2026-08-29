import { describe, expect, it } from "vitest";
import { parseOverpassSignals, parseTrafficSignals } from "./parsers";

describe("source parsers", () => {
  it("normalizes a DataSF signal without inventing timing fields", () => {
    const rows = parseTrafficSignals({
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        geometry: { type: "Point", coordinates: [-122.4, 37.78] },
        properties: {
          cnn: "26586000",
          sig_num: "0",
          street1: "MARKET",
          street2: "03RD",
          ped_signal: "n.a.",
          rlcam: "YES",
          data_as_of: "2024-05-28T15:16:47.000",
        },
      }],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      cnn: "26586000",
      signalNumber: null,
      name: "MARKET & 03RD",
      normalizedStreets: ["MARKET", "3RD"],
      pedestrianSignal: null,
      redLightCamera: true,
    });
    expect(rows[0].rawProperties).not.toHaveProperty("cycle");
  });

  it("attaches nearby named roads to OSM signal components", () => {
    const rows = parseOverpassSignals({
      osm3s: { timestamp_osm_base: "2026-08-01T00:00:00Z" },
      elements: [
        { type: "node", id: 1, lat: 37.78, lon: -122.4, tags: { highway: "traffic_signals" } },
        {
          type: "way",
          id: 2,
          tags: { highway: "primary", name: "Market Street" },
          geometry: [{ lat: 37.7799, lon: -122.4002 }, { lat: 37.7801, lon: -122.3998 }],
        },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].nearbyStreets).toEqual(["Market Street"]);
    expect(rows[0].normalizedStreets).toEqual(["MARKET"]);
  });
});

