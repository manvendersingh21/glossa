import { describe, expect, it } from "vitest";
import { pointInPolygonGeometry } from "./geo";

describe("pointInPolygonGeometry", () => {
  const geometry = {
    type: "Polygon",
    coordinates: [
      [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
      [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],
    ],
  };

  it("includes the exterior and boundary", () => {
    expect(pointInPolygonGeometry([2, 2], geometry)).toBe(true);
    expect(pointInPolygonGeometry([0, 5], geometry)).toBe(true);
  });

  it("excludes holes and exterior points", () => {
    expect(pointInPolygonGeometry([5, 5], geometry)).toBe(false);
    expect(pointInPolygonGeometry([20, 5], geometry)).toBe(false);
  });
});

