import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/server/api-error";
import { query } from "@/lib/server/db";
import { estimateRoute, routeEstimateRequestSchema } from "@/lib/server/route-estimate";
import { parseSfmtaTimingDocument } from "@/lib/data/sfmta-timing-parser";
import reviewedCard from "../../data/reference/sfmta-5th-mission-reviewed.json";

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

/** Resolve every Google fetch with a fresh Response (the body can only be read once). */
function mockGoogle(body: unknown, status = 200): void {
  fetchMock.mockImplementation(() => Promise.resolve(googleResponse(body, status)));
}

function googleRoute(overrides: Record<string, unknown> = {}) {
  return {
    routes: [
      {
        duration: "600s",
        staticDuration: "500s",
        distanceMeters: 5000,
        polyline: { encodedPolyline },
        ...overrides,
      },
    ],
  };
}

/** A route whose Google delay (duration - staticDuration) equals `delay`. */
function googleRouteWithDelay(delay: number) {
  const total = 500 + delay;
  return googleRoute({ duration: `${total}s`, staticDuration: "500s" });
}

function planWithGreenWindow(cycle = 90, offset = 0, greenStart = 0, greenEnd = 30) {
  return [
    {
      id: "all-day",
      label: "All day",
      days: ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"],
      startTime: "00:00",
      endTime: "24:00",
      cycleSeconds: cycle,
      offsetSeconds: offset,
      phaseSequence: [2],
      phaseIntervals: [
        { phase: 2, movement: "northbound through", greenStartSeconds: greenStart, greenEndSeconds: greenEnd },
      ],
    },
  ];
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
    source_as_of: null,
    distance_meters: 10,
    route_position: 0.5,
    time_of_day_plans: null,
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
  it("decodes Google's encoded polyline into GeoJSON route coordinates, one query per departure", async () => {
    mockGoogle(googleRoute({ duration: "120s", staticDuration: "100s" }));

    await estimateRoute(request());

    // One route query per compared departure time (default cap 3).
    expect(queryMock.mock.calls).toHaveLength(3);
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

  it("keeps the Google API key server-side in the route request headers", async () => {
    mockGoogle(googleRoute());

    await estimateRoute(request());

    const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.headers as Record<string, string> | undefined;
    expect(headers?.["X-Goog-Api-Key"]).toBe("test-google-key");
    expect(headers?.["Content-Type"]).toBe("application/json");
  });

  it("rejects a route polyline with fewer than two decoded points", async () => {
    mockGoogle({ routes: [{ polyline: { encodedPolyline: "??" } }] });

    await expect(estimateRoute(request())).rejects.toMatchObject({
      status: 502,
      code: "route_unavailable",
      message: "Google returned an unusable route.",
    });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("surfaces Google's message for an unsuccessful response as an API error", async () => {
    mockGoogle(
      { error: { message: "The provided API key is invalid." } },
      403,
    );

    await expect(estimateRoute(request())).rejects.toMatchObject({
      status: 502,
      code: "route_unavailable",
      message: "The provided API key is invalid.",
    });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("returns a 502 when Google responds successfully without a route", async () => {
    mockGoogle({ routes: [] });

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

describe("route estimate signal model", () => {
  beforeEach(() => {
    mockGoogle(googleRoute());
  });

  it("returns zero stops and delay when no signals are matched", async () => {
    queryMock.mockResolvedValue([]);

    const result = await estimateRoute(request());

    expect(result.estimate.likelySignalStops).toEqual([0, 0]);
    expect(result.estimate.likelySignalDelaySeconds).toEqual([0, 0]);
    expect(result.estimate.expectedSignalDelaySeconds).toBe(0);
  });

  it("uses conservative stop and delay ranges when signals lack cycle timing", async () => {
    queryMock.mockResolvedValue(
      Array.from({ length: 4 }, (_, index) =>
        signalRow({ cnn: `modeled-${index}`, route_position: 0.1 * (index + 1) }),
      ) as never,
    );

    const result = await estimateRoute(request());

    expect(result.estimate.expectedSignalStops).toBe(2);
    expect(result.estimate.likelySignalStops).toEqual([0, 4]);
    expect(result.estimate.expectedSignalDelaySeconds).toBe(90);
    expect(result.estimate.likelySignalDelaySeconds).toEqual([0, 240]);
    expect(result.estimate.confidence).toBe("low");
    expect(result.estimate.unknownSignals).toBe(4);
    expect(result.estimate.modeledSignals).toBe(0);
  });

  it("passes Google route arrival times into the signal model and reports a complete recommendation", async () => {
    // Route positions map arrival (position * 600s) onto phase 0 (green) and 45 (red),
    // so exactly four signals arrive during green and four during red.
    const positions = [0, 0.075, 0.15, 0.225, 0.3, 0.375, 0.45, 0.525];
    queryMock.mockResolvedValue(
      positions.map((routePosition, index) =>
        signalRow({
          cnn: `signal-${index}`,
          name: `${index} & Mission`,
          timing_kind: "current_official",
          cycle_seconds: 90,
          route_position: routePosition,
          time_of_day_plans: planWithGreenWindow(90, 0, 0, 30),
        }),
      ) as never,
    );

    const result = await estimateRoute(request());

    // Arrival times are derived from Google's per-candidate duration and route position.
    expect(result.signals).toHaveLength(8);
    expect(result.signals[0].arrivalSeconds).toBe(0);
    expect(result.signals[1].arrivalSeconds).toBe(45);
    expect(result.signals[3].arrivalSeconds).toBe(135);

    // Phase-positioned stops/delay from the signal model.
    expect(result.estimate.expectedSignalStops).toBe(4);
    expect(result.estimate.likelySignalStops).toEqual([4, 4]);
    expect(result.estimate.expectedSignalDelaySeconds).toBe(180);
    expect(result.estimate.likelySignalDelaySeconds).toEqual([180, 180]);
    expect(result.estimate.confidence).toBe("high");
    expect(result.estimate.modeledSignals).toBe(8);
    expect(result.estimate.unknownSignals).toBe(0);
    expect(result.estimate.rationale).toContain("arrival time");

    // Backward-compatible shape preserved for the UI.
    expect(result.route.durationSeconds).toBe(600);
    expect(result.departureTime).toBe(result.recommendation.recommendedDepartureTime);

    // Canonical recommendation object (Agent 6 binds these names).
    expect(Object.keys(result.recommendation).sort()).toEqual([
      "candidatesConsidered",
      "confidence",
      "explanation",
      "likelySignalStops",
      "rankedAlternatives",
      "recommendedDepartureTime",
      "scoreRangeSeconds",
      "scoreSeconds",
      "signalDelaySeconds",
      "trafficDelaySeconds",
    ]);
    expect(result.recommendation.candidatesConsidered).toBe(3);
    expect(result.recommendation.confidence).toBe("high");
    expect(result.recommendation.trafficDelaySeconds).toBe(100);
    expect(result.recommendation.signalDelaySeconds).toEqual([180, 180]);
    expect(result.recommendation.scoreSeconds).toBe(280);
    expect(result.recommendation.scoreRangeSeconds).toEqual([280, 280]);
    expect(result.recommendation.explanation).toContain("Compared 3 departure times");
    expect(result.recommendation.rankedAlternatives).toHaveLength(3);
    // Ranked best-first; the recommended entry matches recommendedDepartureTime.
    expect(result.recommendation.rankedAlternatives[0].recommended).toBe(true);
    expect(result.recommendation.rankedAlternatives[0].departureTime).toBe(result.recommendation.recommendedDepartureTime);
  });

  it("preserves source-as-of timing status from signal_catalog per signal", async () => {
    queryMock.mockResolvedValue([
      signalRow({ cnn: "with-source", timing_kind: "current_official", cycle_seconds: 90, source_as_of: "2022-10-20T00:00:00.000Z" }),
      signalRow({ cnn: "no-source", timing_kind: "unknown" }),
    ] as never);

    const result = await estimateRoute(request());

    const withSource = result.signals.find((signal) => signal.cnn === "with-source");
    const noSource = result.signals.find((signal) => signal.cnn === "no-source");
    expect(withSource?.sourceAsOf).toBe("2022-10-20T00:00:00.000Z");
    expect(noSource?.sourceAsOf).toBeNull();
  });
});

describe("route estimate departure recommendation", () => {
  it("compares multiple departure times and recommends the lowest-delay departure", async () => {
    fetchMock
      .mockImplementationOnce(() => Promise.resolve(googleResponse(googleRouteWithDelay(200))))
      .mockImplementationOnce(() => Promise.resolve(googleResponse(googleRouteWithDelay(100))))
      .mockImplementationOnce(() => Promise.resolve(googleResponse(googleRouteWithDelay(150))));
    queryMock.mockResolvedValue([]);

    const result = await estimateRoute(request());

    // Only traffic differs (no signals); the lowest-delay middle slot is recommended.
    expect(result.recommendation.candidatesConsidered).toBe(3);
    expect(result.recommendation.rankedAlternatives).toHaveLength(3);
    // Ranked best-first by score (delay): 100, 150, 200.
    expect(result.recommendation.rankedAlternatives[0].trafficDelaySeconds).toBe(100);
    expect(result.recommendation.rankedAlternatives[0].recommended).toBe(true);
    expect(result.recommendation.rankedAlternatives[1].trafficDelaySeconds).toBe(150);
    expect(result.recommendation.rankedAlternatives[2].trafficDelaySeconds).toBe(200);
    expect(result.recommendation.recommendedDepartureTime).toBe(result.recommendation.rankedAlternatives[0].departureTime);
    // The chosen route/delay mirror the recommended departure.
    expect(result.route.durationSeconds).toBe(600);
    expect(result.route.delaySeconds).toBe(100);
    expect(result.recommendation.scoreSeconds).toBe(100);
    expect(result.recommendation.trafficDelaySeconds).toBe(100);
    expect(result.departureTime).toBe(result.recommendation.recommendedDepartureTime);
  });
});

describe("route estimate cost control (GLOSSA_MAX_DEPARTURE_CANDIDATES)", () => {
  it("defaults to 3 Google calls and clamps an explicit higher cap to 5", async () => {
    mockGoogle(googleRoute());

    await estimateRoute(request());
    expect(fetchMock.mock.calls).toHaveLength(3);
  });

  it("clamps a cap above the maximum to 5 Google calls", async () => {
    vi.stubEnv("GLOSSA_MAX_DEPARTURE_CANDIDATES", "10");
    mockGoogle(googleRoute());

    const result = await estimateRoute(request());

    expect(fetchMock.mock.calls).toHaveLength(5);
    expect(result.recommendation.candidatesConsidered).toBe(5);
    expect(result.recommendation.rankedAlternatives).toHaveLength(5);
  });

  it("clamps a cap below the minimum to a single Google call", async () => {
    vi.stubEnv("GLOSSA_MAX_DEPARTURE_CANDIDATES", "0");
    mockGoogle(googleRoute());

    const result = await estimateRoute(request());

    expect(fetchMock.mock.calls).toHaveLength(1);
    expect(result.recommendation.candidatesConsidered).toBe(1);
    expect(result.recommendation.rankedAlternatives).toHaveLength(1);
  });

  it("respects an explicit cap of 1", async () => {
    vi.stubEnv("GLOSSA_MAX_DEPARTURE_CANDIDATES", "1");
    mockGoogle(googleRoute());

    const result = await estimateRoute(request());

    expect(fetchMock.mock.calls).toHaveLength(1);
    expect(result.recommendation.candidatesConsidered).toBe(1);
  });

  it("skips a failed non-primary candidate without failing the whole request", async () => {
    // Default cap 3: primary (slot 0) succeeds, slot 1 fails (non-primary), slot 2 succeeds.
    fetchMock
      .mockImplementationOnce(() => Promise.resolve(googleResponse(googleRouteWithDelay(200))))
      .mockImplementationOnce(() => Promise.resolve(googleResponse({ error: { message: "bad slot" } }, 403)))
      .mockImplementationOnce(() => Promise.resolve(googleResponse(googleRouteWithDelay(100))));
    queryMock.mockResolvedValue([]);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await estimateRoute(request());

    // All three slots were attempted via Google, but only two were scored.
    expect(fetchMock.mock.calls).toHaveLength(3);
    expect(queryMock.mock.calls).toHaveLength(2);
    expect(result.recommendation.candidatesConsidered).toBe(2);
    expect(result.recommendation.rankedAlternatives).toHaveLength(2);
    // The best remaining slot (delay 100, slot 2) is recommended.
    expect(result.recommendation.rankedAlternatives[0].trafficDelaySeconds).toBe(100);
    expect(result.recommendation.rankedAlternatives[0].recommended).toBe(true);
    expect(result.route.delaySeconds).toBe(100);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("fails the whole request when the primary candidate fails", async () => {
    fetchMock
      .mockImplementationOnce(() => Promise.resolve(googleResponse({ error: { message: "primary failed" } }, 403)))
      .mockImplementation(() => Promise.resolve(googleResponse(googleRoute())));

    await expect(estimateRoute(request())).rejects.toMatchObject({
      status: 502,
      code: "route_unavailable",
      message: "primary failed",
    });
    // Primary failed fast; only the primary Google call was made.
    expect(fetchMock.mock.calls).toHaveLength(1);
    expect(queryMock).not.toHaveBeenCalled();
  });
});

describe("route estimate honesty", () => {
  beforeEach(() => {
    mockGoogle(googleRoute());
  });

  it("reads stale evidence as low confidence with a conservative explanation", async () => {
    queryMock.mockResolvedValue([
      signalRow({ cnn: "stale", timing_kind: "stale_official", cycle_seconds: 90, source_as_of: "2021-01-01T00:00:00.000Z" }),
    ] as never);

    const result = await estimateRoute(request());

    expect(result.estimate.confidence).toBe("low");
    expect(result.recommendation.confidence).toBe("low");
    expect(result.signals[0].timingKind).toBe("stale_official");
    expect(result.estimate.explanation).toContain("stale or unavailable");
  });

  it("reads unknown evidence as low confidence without claiming a live phase feed", async () => {
    queryMock.mockResolvedValue([
      signalRow({ cnn: "unknown", timing_kind: "unknown" }),
    ] as never);

    const result = await estimateRoute(request());

    expect(result.estimate.confidence).toBe("low");
    expect(result.recommendation.confidence).toBe("low");
    // Honesty note explicitly disclaims a live feed rather than asserting one.
    expect(result.estimate.explanation).toContain("not a live phase read");
    expect(result.estimate.explanation).not.toContain("live red");
    expect(result.estimate.explanation).not.toContain("live green");
  });
});

describe("route estimate timing-parser integration", () => {
  beforeEach(() => {
    mockGoogle(googleRoute());
  });

  it("consumes parsed SFMTA plan evidence through the signal model", async () => {
    // The reviewed 5th/Mission card has cycle/offset plans but transcribed phase
    // intervals are empty, so the model falls back to cycle-based estimates while
    // still running the full parser -> inventory -> model chain.
    const card = parseSfmtaTimingDocument(reviewedCard);
    queryMock.mockResolvedValue([
      signalRow({
        cnn: "24634000",
        name: "5th Street and Mission Street",
        timing_kind: "current_official",
        cycle_seconds: 90,
        time_of_day_plans: card.plans,
      }),
    ] as never);

    const result = await estimateRoute(request());

    expect(result.estimate.modeledSignals).toBe(1);
    expect(result.estimate.unknownSignals).toBe(0);
    expect(result.estimate.confidence).toBe("high");
    expect(result.estimate.likelySignalStops).toEqual([0, 1]);
    expect(result.estimate.likelySignalDelaySeconds).toEqual([22, 23]);
    expect(result.signals[0].cnn).toBe("24634000");
  });
});
