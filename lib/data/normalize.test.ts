import { describe, expect, it } from "vitest";
import {
  canonicalCnn,
  inventoryBoolean,
  normalizeStreetName,
  splitCrossStreetLabel,
} from "./normalize";

describe("normalizeStreetName", () => {
  it("aligns DataSF and OSM street spellings", () => {
    expect(normalizeStreetName("03RD ST")).toBe("3RD");
    expect(normalizeStreetName("3rd Street")).toBe("3RD");
    expect(normalizeStreetName("St. Germain Ave")).toBe("SAINT GERMAIN");
    expect(normalizeStreetName("Van Ness Avenue")).toBe("VAN NESS");
  });

  it("splits common intersection labels", () => {
    expect(splitCrossStreetLabel("Market St & 3rd Street")).toEqual(["Market St", "3rd Street"]);
    expect(splitCrossStreetLabel("Mission at 16th")).toEqual(["Mission", "16th"]);
  });
});

describe("inventory value parsing", () => {
  it("does not turn missing inventory values into false assertions", () => {
    expect(inventoryBoolean(null)).toBeNull();
    expect(inventoryBoolean("n.a.")).toBeNull();
    expect(inventoryBoolean("NONE")).toBe(false);
    expect(inventoryBoolean("Type 2070 controller")).toBe(true);
  });

  it("keeps CNN identifiers as digit strings", () => {
    expect(canonicalCnn("26586000.0")).toBe("26586000");
    expect(canonicalCnn("not-a-cnn")).toBeNull();
  });
});

