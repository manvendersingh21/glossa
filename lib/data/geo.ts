import type { DowntownPolygon, GeoJsonGeometry } from "./types";
import { buffer, booleanPointInPolygon, point as turfPoint } from "@turf/turf";

type Position = [number, number];

function isPosition(value: unknown): value is Position {
  return Array.isArray(value)
    && value.length >= 2
    && typeof value[0] === "number"
    && typeof value[1] === "number";
}

function pointOnSegment(point: Position, a: Position, b: Position): boolean {
  const lengthSquared = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
  if (lengthSquared === 0) return point[0] === a[0] && point[1] === a[1];
  const cross = (point[1] - a[1]) * (b[0] - a[0]) - (point[0] - a[0]) * (b[1] - a[1]);
  if (Math.abs(cross) > 1e-10) return false;
  const dot = (point[0] - a[0]) * (b[0] - a[0]) + (point[1] - a[1]) * (b[1] - a[1]);
  return dot >= 0 && dot <= lengthSquared;
}

function pointInRing(point: Position, rawRing: unknown): boolean {
  if (!Array.isArray(rawRing)) return false;
  const ring = rawRing.filter(isPosition);
  if (ring.length < 3) return false;
  let inside = false;
  for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current++) {
    const a = ring[previous];
    const b = ring[current];
    if (pointOnSegment(point, a, b)) return true;
    const intersects = (a[1] > point[1]) !== (b[1] > point[1])
      && point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0];
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInPolygonCoordinates(point: Position, coordinates: unknown): boolean {
  if (!Array.isArray(coordinates) || coordinates.length === 0) return false;
  if (!pointInRing(point, coordinates[0])) return false;
  return !coordinates.slice(1).some((hole) => pointInRing(point, hole));
}

export function pointInPolygonGeometry(point: Position, geometry: GeoJsonGeometry): boolean {
  if (geometry.type === "Polygon") return pointInPolygonCoordinates(point, geometry.coordinates);
  if (geometry.type === "MultiPolygon" && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates.some((polygon) => pointInPolygonCoordinates(point, polygon));
  }
  return false;
}

export function pointInDowntown(point: Position, polygons: DowntownPolygon[]): boolean {
  if (polygons.some((polygon) => pointInPolygonGeometry(point, polygon.geometry))) return true;
  // Signal coordinates lie on the public right-of-way, immediately outside
  // parcel polygons. A small transparent buffer preserves the C-3 definition
  // while including intersections on the bordering streets.
  return polygons.some((polygon) => {
    const feature = { type: "Feature" as const, properties: {}, geometry: polygon.geometry as never };
    const expanded = buffer(feature, 0.04, { units: "kilometers" });
    return expanded ? booleanPointInPolygon(turfPoint(point), expanded) : false;
  });
}
