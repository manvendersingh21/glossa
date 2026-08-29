import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/server/api-error";
import { buildStatsQuery, parseStatsArea } from "@/lib/server/stats";

describe("stats query", () => {
  it("defaults to San Francisco and validates the area allowlist", () => {
    expect(parseStatsArea(new URLSearchParams())).toBe("sf");
    expect(parseStatsArea(new URLSearchParams({ area: "downtown" }))).toBe(
      "downtown",
    );
    expect(() =>
      parseStatsArea(new URLSearchParams({ area: "everything" })),
    ).toThrow(ApiError);
  });

  it("rejects extra or repeated query parameters", () => {
    expect(() =>
      parseStatsArea(new URLSearchParams("area=sf&area=downtown")),
    ).toThrow(ApiError);
    expect(() =>
      parseStatsArea(new URLSearchParams({ area: "sf", live: "true" })),
    ).toThrow(ApiError);
  });

  it("binds area as a SQL parameter", () => {
    const statement = buildStatsQuery("downtown");
    expect(statement.values).toEqual(["downtown"]);
    expect(statement.text).toContain("$1::text");
    expect(statement.text).not.toContain("$2");
  });
});

