import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/server/api-error";
import { query } from "@/lib/server/db";
import {
  estimateRoute,
  routeEstimateRequestSchema,
} from "@/lib/server/route-estimate";

vi.mock("@/lib/server/db", () => ({
  query: vi.fn(),
}));

const queryMock = vi.mocked(query);
const fetchMock = vi.fn();
const encodedPolyline = "_p~iF~ps|U_ulLnnqC_mqNvxq`@";

function googleResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function signalRow(overrides: Record<string, unknown> = {}) {
  return {
    cnn: "12345678",
    name: "Test & Main",
    longitude: -122.4,
    latitude: 37.78,
    timing_kind: "modeled",
    cycle_seconds: null,
    cycle_min_seconds: null,
    cycle_max_seconds: null,
    confidence: "low",
    vehicle_actuated: false,
    pedestrian_actuated: false,
    transit_priority: false,
    distance_meters: 10,
    route_position: 0.5,
    ...overrides,
  };
}

function request() {
  return {
    origin: { latitude: 37.78, longitude: -122.4 },
    destination: { latitude: 37.79, longitude: -122.41 },
  };
}

beforeEach(() => {
  vi.stubEnv("GOOGLE_MAPS_API_KEY", "test-google-key");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  queryMock.mockReset();
  queryMock.mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("route estimate request validation", () => {
  it("accepts an address or a complete coordinate pair and trims addresses", () => {
    const parsed = routeEstimateRequestSchema.parse({
      origin: { address: "  1 Market Street, San Francisco  " },
      destination: { latitude: 37.789, longitude: -122.401 },
      departureTime: "2026-08-29T12:00:00-07:00",
    });

    expect(parsed.origin.address).toBe("1 Market Street, San Francisco");
    expect(parsed.destination).toEqual({ latitude: 37.789, longitude: -122.401 });
  });

  it.each([
    {
      name: "missing both address and coordinates",
      value: { origin: {}, destination: { address: "Destination" } },
    },
    {
      name: "incomplete coordinate pair",
      value: {
        origin: { latitude: 37.78 },
        destination: { longitude: -122.41 },
      },
    },
    {
      name: "coordinates outside their geographic ranges",
      value: {
        origin: { latitude: 91, longitude: -122.4 },
        destination: { latitude: 37.79, longitude: -181 },
      },
    },
    {
      name: "departure time without an offset",
      value: {
        ...request(),
        departureTime: "2026-08-29T12:00:00",
      },
    },
  ])("rejects $name", ({ value }) => {
    expect(() => routeEstimateRequestSchema.parse(value)).toThrow();
  });
});

describe("route estimate Google integration", () => {
  it("decodes Google's encoded polyline into GeoJSON route coordinates", async () => {
    fetchMock.mockResolvedValue(
      googleResponse({
        routes: [
          {
            duration: "120s",
            staticDuration: "100s",
            distanceMeters: 2500,
            polyline: { encodedPolyline },
          },
        ],
      }),
    );

    await estimateRoute(request());

    const values = queryMock.mock.calls[0]?.[1];
    expect(values).toBeDefined();
    const routeGeoJson = JSON.parse(String(values![0]));
    expect(routeGeoJson).toEqual({
      type: "LineString",
      coordinates: [
        [-120.2, 38.5],
        [-120.95, 40.7],
        [-126.453, 43.252],
      ],
    });
  });

  it("rejects a route polyline with fewer than two decoded points", async () => {
    fetchMock.mockResolvedValue(
      googleResponse({
        routes: [{ polyline: { encodedPolyline: "??" } }],
      }),
    );

    await expect(estimateRoute(request())).rejects.toMatchObject({
      status: 502,
      code: "route_unavailable",
      message: "Google returned an unusable route.",
    });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("surfaces Google's message for an unsuccessful response as an API error", async () => {
    fetchMock.mockResolvedValue(
      googleResponse(
        { error: { message: "The provided API key is invalid." } },
        403,
      ),
    );

    await expect(estimateRoute(request())).rejects.toMatchObject({
      status: 502,
      code: "route_unavailable",
      message: "The provided API key is invalid.",
    });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("returns a 502 when Google responds successfully without a route", async () => {
    fetchMock.mockResolvedValue(googleResponse({ routes: [] }));

    await expect(estimateRoute(request())).rejects.toMatchObject({
      status: 502,
      code: "route_unavailable",
      message: "Google could not calculate this route.",
    });
  });

  it("returns a 503 when server-side Google routing is not configured", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "replace_me");

    await expect(estimateRoute(request())).rejects.toBeInstanceOf(ApiError);
    await expect(estimateRoute(request())).rejects.toMatchObject({
      status: 503,
      code: "route_unavailable",
      message: "Google Maps routing is not configured.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("route estimate stop ranges", () => {
  beforeEach(() => {
    fetchMock.mockResolvedValue(
      googleResponse({
        routes: [
          {
            duration: "600s",
            staticDuration: "500s",
            distanceMeters: 5000,
            polyline: { encodedPolyline },
          },
        ],
      }),
    );
  });

  it("uses the conservative 25%-to-90% range without current timing evidence", async () => {
    queryMock.mockResolvedValue(
      Array.from({ length: 4 }, (_, index) =>
        signalRow({ cnn: `modeled-${index}` }),
      ) as never,
    );

    const result = await estimateRoute(request());

    expect(result.estimate.likelySignalStops).toEqual([1, 4]);
    expect(result.estimate.likelySignalDelaySeconds).toEqual([15, 180]);
    expect(result.estimate.confidence).toBe("low");
  });

  it("uses the tighter upper bound when current or observed timing exists", async () => {
    queryMock.mockResolvedValue(
      Array.from({ length: 8 }, (_, index) =>
        signalRow({
          cnn: `signal-${index}`,
          timing_kind: index === 0 ? "current_official" : "modeled",
        }),
      ) as never,
    );

    const result = await estimateRoute(request());

    expect(result.estimate.likelySignalStops).toEqual([2, 6]);
    expect(result.estimate.likelySignalDelaySeconds).toEqual([30, 270]);
    expect(result.estimate.confidence).toBe("medium");
  });

  it("returns zero stops and delay when no signals are matched", async () => {
    queryMock.mockResolvedValue([]);

    const result = await estimateRoute(request());

    expect(result.estimate.likelySignalStops).toEqual([0, 0]);
    expect(result.estimate.likelySignalDelaySeconds).toEqual([0, 0]);
  });
});
