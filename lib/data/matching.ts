import type {
  ComponentMatch,
  MatchCandidate,
  NormalizedIntersection,
  OsmSignalComponent,
} from "./types";

const EARTH_RADIUS_M = 6_371_008.8;

function radians(value: number): number {
  return (value * Math.PI) / 180;
}

export function haversineMeters(a: [number, number], b: [number, number]): number {
  const lat1 = radians(a[1]);
  const lat2 = radians(b[1]);
  const deltaLat = lat2 - lat1;
  const deltaLon = radians(b[0] - a[0]);
  const h = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

// A local equirectangular projection is accurate enough for the <= 100 m join window.
export function distancePointToLineMeters(
  point: [number, number],
  line: Array<[number, number]>,
): number {
  if (line.length === 0) return Number.POSITIVE_INFINITY;
  if (line.length === 1) return haversineMeters(point, line[0]);
  const latitude = radians(point[1]);
  const scaleX = Math.cos(latitude) * 111_320;
  const scaleY = 110_540;
  const px = point[0] * scaleX;
  const py = point[1] * scaleY;
  let best = Number.POSITIVE_INFINITY;
  for (let index = 1; index < line.length; index += 1) {
    const ax = line[index - 1][0] * scaleX;
    const ay = line[index - 1][1] * scaleY;
    const bx = line[index][0] * scaleX;
    const by = line[index][1] * scaleY;
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
    best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
  }
  return best;
}

export function scoreCandidate(
  component: Pick<OsmSignalComponent, "coordinates" | "normalizedStreets">,
  intersection: Pick<NormalizedIntersection, "cnn" | "coordinates" | "normalizedStreets">,
  maxDistanceM = 80,
): MatchCandidate | null {
  const distanceM = haversineMeters(component.coordinates, intersection.coordinates);
  if (distanceM > maxDistanceM) return null;
  const expected = new Set(intersection.normalizedStreets);
  const observed = new Set(component.normalizedStreets);
  const streetOverlap = [...observed].filter((street) => expected.has(street)).length;
  const streetCoverage = expected.size === 0 ? 0 : streetOverlap / Math.min(2, expected.size);
  const spatialScore = Math.max(0, 1 - distanceM / maxDistanceM);
  // Street context makes the join safer, but spatial evidence still permits low-confidence
  // matches for OSM components whose nearby ways are unnamed.
  const score = observed.size > 0
    ? spatialScore * 0.65 + Math.min(1, streetCoverage) * 0.35
    : spatialScore * 0.65;
  return {
    cnn: intersection.cnn,
    distanceM,
    streetOverlap,
    streetCoverage,
    score: Math.min(1, score),
  };
}

export function matchComponent(
  component: OsmSignalComponent,
  intersections: NormalizedIntersection[],
  maxDistanceM = 80,
): ComponentMatch {
  const candidates = intersections
    .map((intersection) => scoreCandidate(component, intersection, maxDistanceM))
    .filter((candidate): candidate is MatchCandidate => candidate !== null)
    .sort((a, b) => b.score - a.score || a.distanceM - b.distanceM || a.cnn.localeCompare(b.cnn))
    .slice(0, 5);
  const top = candidates[0];
  if (!top || top.score < 0.28) {
    return {
      status: "unmatched",
      confidence: "unknown",
      method: "spatial+normalized_cross_streets:v1",
      intersectionCnn: null,
      distanceM: top?.distanceM ?? null,
      streetOverlap: top?.streetOverlap ?? 0,
      score: top?.score ?? null,
      candidates,
    };
  }

  const second = candidates[1];
  const gap = second ? top.score - second.score : 1;
  if (second && gap < 0.075 && !(top.streetOverlap >= 2 && top.distanceM <= 20)) {
    return {
      status: "ambiguous",
      confidence: "unknown",
      method: "spatial+normalized_cross_streets:v1",
      intersectionCnn: null,
      distanceM: top.distanceM,
      streetOverlap: top.streetOverlap,
      score: top.score,
      candidates,
    };
  }

  let confidence: ComponentMatch["confidence"] = "low";
  if ((top.streetOverlap >= 2 && top.distanceM <= 25)
    || (top.streetOverlap >= 1 && top.distanceM <= 8)) {
    confidence = "high";
  } else if ((top.streetOverlap >= 1 && top.distanceM <= 40)
    || (top.distanceM <= 12 && gap >= 0.12)) {
    confidence = "medium";
  }
  return {
    status: "matched",
    confidence,
    method: "spatial+normalized_cross_streets:v1",
    intersectionCnn: top.cnn,
    distanceM: top.distanceM,
    streetOverlap: top.streetOverlap,
    score: top.score,
    candidates,
  };
}

