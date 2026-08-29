import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/server/api-error";
import { encodeCursor } from "@/lib/server/cursor";
import {
  buildExportQuery,
  buildSignalByIdQuery,
  buildSignalsQuery,
} from "@/lib/server/signals";

describe("signal SQL", () => {
  it("binds filter and cursor values instead of interpolating them", () => {
    const hostileId = "1000'; DROP TABLE intersections; --";
    const statement = buildSignalsQuery({
      bbox: [-122.53, 37.7, -122.35, 37.84],
      downtown: false,
      timingKind: "modeled",
      capability: "transitPriority",
      limit: 25,
      cursor: encodeCursor(hostileId),
    });

    expect(statement.values).toEqual([
      -122.53,
      37.7,
      -122.35,
      37.84,
      false,
      "modeled",
      hostileId,
      26,
    ]);
    expect(statement.text).not.toContain(hostileId);
    expect(statement.text).toContain("s.transit_priority IS TRUE");
    expect(statement.text).toContain("s.id > $7");
    expect(statement.text).toContain("LIMIT $8");
  });

  it("binds a detail id", () => {
    const statement = buildSignalByIdQuery("12345");
    expect(statement.values).toEqual(["12345"]);
    expect(statement.text).toContain("WHERE s.id = $1");
    expect(statement.text).not.toContain("12345");
  });

  it("caps an export with one extra row for overflow detection", () => {
    const statement = buildExportQuery(
      { format: "csv", downtown: true },
      50_000,
    );
    expect(statement.values).toEqual([true, 50_001]);
    expect(statement.text).toContain("s.downtown = $1");
    expect(statement.text).toContain("LIMIT $2");
  });

  it("rejects a malformed cursor before querying", () => {
    expect(() =>
      buildSignalsQuery({ limit: 10, cursor: "not-a-versioned-cursor" }),
    ).toThrow(ApiError);
  });
});

