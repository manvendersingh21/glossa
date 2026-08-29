import { describe, expect, it } from "vitest";
import { parseTimingCards } from "./timing-cards";

const HEADER = "import_key,cnn,evidence_kind,cycle_nominal_seconds,cycle_min_seconds,cycle_max_seconds,confidence,model_version,rationale,source_url,source_as_of,stale_after\n";

describe("timing card validation", () => {
  it("preserves a documented range separately from evidence kind", () => {
    const [row] = parseTimingCards(HEADER
      + "obs-1,123,observed,,80,100,medium,,Observed 4 cycles|Peak period,https://example.test/1,2026-08-01,\n");
    expect(row.evidenceKind).toBe("observed");
    expect(row.cycleNominalSeconds).toBeNull();
    expect([row.cycleMinSeconds, row.cycleMaxSeconds]).toEqual([80, 100]);
    expect(row.rationale).toEqual(["Observed 4 cycles", "Peak period"]);
  });

  it("requires a freshness cutoff for official evidence", () => {
    expect(() => parseTimingCards(HEADER
      + "official-1,123,official,90,,,high,,Card,https://example.test/1,2026-08-01,\n"))
      .toThrow(/requires stale_after/);
  });

  it("requires model version only for modeled evidence", () => {
    expect(() => parseTimingCards(HEADER
      + "model-1,123,modeled,90,,,low,,Estimate,https://example.test/1,2026-08-01,\n"))
      .toThrow(/requires model_version/);
  });
});
