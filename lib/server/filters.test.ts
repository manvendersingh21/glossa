import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/server/api-error";
import { parseExportQuery, parseSignalFilters } from "@/lib/server/filters";

describe("parseSignalFilters", () => {
  it("uses a bounded default page size", () => {
    expect(parseSignalFilters(new URLSearchParams())).toEqual({ limit: 500 });
  });

  it("parses every supported filter", () => {
    const params = new URLSearchParams({
      bbox: "-122.53,37.70,-122.35,37.84",
      downtown: "true",
      timingKind: "modeled",
      capability: "transitPriority",
      limit: "25",
      cursor: "opaque",
    });

    expect(parseSignalFilters(params)).toEqual({
      bbox: [-122.53, 37.7, -122.35, 37.84],
      downtown: true,
      timingKind: "modeled",
      capability: "transitPriority",
      limit: 25,
      cursor: "opaque",
    });
  });

  it.each([
    "-122.4,37.8,-122.5,37.7",
    "-181,37,-122,38",
    "-122,37,not-a-number,38",
    "-122,37,-121",
    "-122,,0,38",
  ])("rejects invalid bbox %s", (bbox) => {
    expect(() => parseSignalFilters(new URLSearchParams({ bbox }))).toThrow(
      ApiError,
    );
  });

  it("rejects unknown and duplicate parameters", () => {
    expect(() =>
      parseSignalFilters(new URLSearchParams("limit=1&limit=2")),
    ).toThrow(ApiError);
    expect(() =>
      parseSignalFilters(new URLSearchParams("sort=DROP+TABLE")),
    ).toThrow(ApiError);
  });

  it("rejects an excessive page size", () => {
    expect(() =>
      parseSignalFilters(new URLSearchParams({ limit: "2001" })),
    ).toThrow(ApiError);
  });
});

describe("parseExportQuery", () => {
  it("defaults to GeoJSON and accepts the same non-pagination filters", () => {
    expect(
      parseExportQuery(
        new URLSearchParams({ downtown: "false", timingKind: "unknown" }),
      ),
    ).toEqual({
      format: "geojson",
      downtown: false,
      timingKind: "unknown",
    });
  });

  it("rejects list pagination parameters", () => {
    expect(() =>
      parseExportQuery(new URLSearchParams({ format: "csv", limit: "100" })),
    ).toThrow(ApiError);
  });
});
