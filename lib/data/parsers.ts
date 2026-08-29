import {
  canonicalCnn,
  inventoryBoolean,
  maxDate,
  normalizeStreetName,
  normalizeStreetSet,
  optionalDate,
  optionalString,
  splitCrossStreetLabel,
  uniqueNonEmpty,
} from "./normalize";
import { distancePointToLineMeters } from "./matching";
import type {
  DowntownPolygon,
  GeoJsonFeatureCollection,
  GeoJsonGeometry,
  JsonObject,
  NormalizedIntersection,
  NormalizedStreetSegment,
  OsmSignalComponent,
  OverpassResponse,
} from "./types";

function isCoordinatePair(value: unknown): value is [number, number] {
  return Array.isArray(value)
    && value.length >= 2
    && typeof value[0] === "number"
    && typeof value[1] === "number"
    && Number.isFinite(value[0])
    && Number.isFinite(value[1]);
}

function pointCoordinates(geometry: GeoJsonGeometry | null): [number, number] | null {
  return geometry?.type === "Point" && isCoordinatePair(geometry.coordinates)
    ? [geometry.coordinates[0], geometry.coordinates[1]]
    : null;
}

function booleanProperty(value: unknown): boolean {
  return value === true || value === "true" || value === "TRUE" || value === "Y";
}

export function parseTrafficSignals(collection: GeoJsonFeatureCollection): NormalizedIntersection[] {
  const rows: NormalizedIntersection[] = [];
  for (const feature of collection.features) {
    const properties = feature.properties ?? {};
    const cnn = canonicalCnn(properties.cnn);
    const coordinates = pointCoordinates(feature.geometry);
    if (!cnn || !coordinates) continue;
    const streetNames = uniqueNonEmpty([
      optionalString(properties.street1),
      optionalString(properties.street2),
      optionalString(properties.street3),
      optionalString(properties.street4),
    ]);
    const preemption = optionalString(properties.preempt_pr);
    const signalNumber = optionalString(properties.sig_num);
    rows.push({
      cnn,
      objectId: optionalString(properties.objectid),
      signalNumber: signalNumber === "0" ? null : signalNumber,
      name: streetNames.length ? streetNames.join(" & ") : `CNN ${cnn}`,
      streetNames,
      normalizedStreets: normalizeStreetSet(streetNames),
      type: optionalString(properties.type),
      detection: optionalString(properties.detection),
      vehicleActuated: inventoryBoolean(properties.veh_actuat),
      pedestrianSignal: inventoryBoolean(properties.ped_signal),
      pedestrianActuated: inventoryBoolean(properties.ped_actuat),
      accessiblePedestrianSignal: inventoryBoolean(properties.aps),
      transitPriority: preemption === null ? null : /\b(?:TSP|TRANSIT)\b/i.test(preemption),
      emergencyPreemption: preemption === null
        ? null
        : /\b(?:EVP|EMERGENCY|FIRE|POLICE)\b/i.test(preemption),
      redLightCamera: inventoryBoolean(properties.rlcam),
      coordinates,
      inventoryAsOf: optionalDate(properties.data_as_of),
      dataLoadedAt: optionalDate(properties.data_loaded_at),
      rawProperties: properties,
    });
  }
  return rows;
}

export function parseStreetSegments(collection: GeoJsonFeatureCollection): NormalizedStreetSegment[] {
  const rows: NormalizedStreetSegment[] = [];
  for (const feature of collection.features) {
    const properties = feature.properties ?? {};
    const cnn = canonicalCnn(properties.cnn);
    const streetName = optionalString(properties.streetname_gc)
      ?? optionalString(properties.streetname)
      ?? optionalString(properties.street);
    if (!cnn || !streetName || !feature.geometry) continue;
    const classCode = Number(optionalString(properties.classcode));
    rows.push({
      cnn,
      streetName,
      normalizedStreetName: normalizeStreetName(streetName),
      fromStreet: optionalString(properties.f_st),
      toStreet: optionalString(properties.t_st),
      fromNodeCnn: canonicalCnn(properties.f_node_cnn),
      toNodeCnn: canonicalCnn(properties.t_node_cnn),
      classCode: Number.isFinite(classCode) ? classCode : null,
      active: booleanProperty(properties.active),
      layer: optionalString(properties.layer),
      geometry: feature.geometry,
      sourceAsOf: optionalDate(properties.data_as_of),
      dataLoadedAt: optionalDate(properties.data_loaded_at),
      rawProperties: properties,
    });
  }
  return rows;
}

export function parseDowntownPolygons(collection: GeoJsonFeatureCollection): DowntownPolygon[] {
  const rows: DowntownPolygon[] = [];
  for (const feature of collection.features) {
    const properties = feature.properties ?? {};
    const zoningCode = optionalString(properties.zoning_sim);
    const objectId = Number(properties.objectid);
    if (!zoningCode?.startsWith("C-3") || !Number.isInteger(objectId) || !feature.geometry) continue;
    if (feature.geometry.type !== "Polygon" && feature.geometry.type !== "MultiPolygon") continue;
    rows.push({
      objectId,
      zoningCode,
      districtName: optionalString(properties.districtname),
      sourceLastEditedAt: parseArcGisDate(properties.last_edit),
      geometry: feature.geometry,
      rawProperties: properties,
    });
  }
  return rows;
}

function parseArcGisDate(value: unknown): Date | null {
  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? null : date;
  }
  return optionalDate(value);
}

function elementPoint(element: OverpassResponse["elements"][number]): [number, number] | null {
  if (typeof element.lon === "number" && typeof element.lat === "number") {
    return [element.lon, element.lat];
  }
  if (element.center) return [element.center.lon, element.center.lat];
  if (element.geometry?.length) {
    const valid = element.geometry.filter((coordinate) =>
      Number.isFinite(coordinate.lon) && Number.isFinite(coordinate.lat));
    if (valid.length) {
      return [
        valid.reduce((sum, coordinate) => sum + coordinate.lon, 0) / valid.length,
        valid.reduce((sum, coordinate) => sum + coordinate.lat, 0) / valid.length,
      ];
    }
  }
  return null;
}

export function parseOverpassSignals(response: OverpassResponse): OsmSignalComponent[] {
  const roads = response.elements.flatMap((element) => {
    const name = element.tags?.name;
    if (element.type !== "way" || !element.tags?.highway || !name || !element.geometry?.length) return [];
    return [{
      name,
      line: element.geometry.map((coordinate) => [coordinate.lon, coordinate.lat] as [number, number]),
    }];
  });

  const rows: OsmSignalComponent[] = [];
  for (const element of response.elements) {
    const tags = element.tags ?? {};
    if (tags.highway !== "traffic_signals" && tags.crossing !== "traffic_signals") continue;
    const coordinates = elementPoint(element);
    if (!coordinates) continue;
    const taggedNames = uniqueNonEmpty([
      ...splitCrossStreetLabel(tags.name ?? ""),
      ...splitCrossStreetLabel(tags["traffic_signals:name"] ?? ""),
    ]);
    const nearbyNames = roads
      .filter((road) => distancePointToLineMeters(coordinates, road.line) <= 45)
      .map((road) => road.name);
    const nearbyStreets = uniqueNonEmpty([...taggedNames, ...nearbyNames]);
    rows.push({
      osmType: element.type,
      osmId: element.id,
      coordinates,
      tags,
      nearbyStreets,
      normalizedStreets: normalizeStreetSet(nearbyStreets),
    });
  }
  return rows;
}

export function signalSourceAsOf(rows: NormalizedIntersection[]): Date | null {
  return maxDate(rows.map((row) => row.inventoryAsOf));
}

export function streetSourceAsOf(rows: NormalizedStreetSegment[]): Date | null {
  return maxDate(rows.map((row) => row.sourceAsOf));
}

export function downtownSourceAsOf(rows: DowntownPolygon[]): Date | null {
  return maxDate(rows.map((row) => row.sourceLastEditedAt));
}

export function assertFeatureCollection(value: unknown, label: string): GeoJsonFeatureCollection {
  const candidate = value as Partial<GeoJsonFeatureCollection>;
  if (candidate?.type !== "FeatureCollection" || !Array.isArray(candidate.features)) {
    throw new Error(`${label} did not return a GeoJSON FeatureCollection`);
  }
  return candidate as GeoJsonFeatureCollection;
}

export function assertOverpassResponse(value: unknown): OverpassResponse {
  const candidate = value as Partial<OverpassResponse>;
  if (!candidate || !Array.isArray(candidate.elements)) {
    throw new Error("Overpass did not return an elements array");
  }
  return candidate as OverpassResponse;
}

export function describeSourceOmissions(): JsonObject {
  return {
    cycleTiming: false,
    phaseTiming: false,
    liveState: false,
    note: "The DataSF Traffic Signals inventory currently contains equipment inventory and location fields, not cycle, phase, or live state data.",
  };
}
