import { matchComponent } from "./matching";
import {
  parseDowntownPolygons,
  parseOverpassSignals,
  parseStreetSegments,
  parseTrafficSignals,
} from "./parsers";
import type {
  ComponentMatch,
  DowntownPolygon,
  LoadedSources,
  NormalizedIntersection,
  NormalizedStreetSegment,
  OsmSignalComponent,
} from "./types";

export interface PreparedData {
  intersections: NormalizedIntersection[];
  streets: NormalizedStreetSegment[];
  downtownPolygons: DowntownPolygon[];
  osmComponents: Array<{ component: OsmSignalComponent; match: ComponentMatch }>;
}

function dedupeBy<T>(values: T[], key: (value: T) => string): T[] {
  const result = new Map<string, T>();
  for (const value of values) result.set(key(value), value);
  return [...result.values()];
}

export function prepareData(sources: LoadedSources): PreparedData {
  const intersections = dedupeBy(parseTrafficSignals(sources.signals.data), (row) => row.cnn);
  const streets = dedupeBy(parseStreetSegments(sources.streets.data), (row) => row.cnn);
  const downtownPolygons = dedupeBy(
    parseDowntownPolygons(sources.downtown.data),
    (row) => String(row.objectId),
  );
  const components = dedupeBy(
    parseOverpassSignals(sources.osm.data),
    (row) => `${row.osmType}/${row.osmId}`,
  );
  const osmComponents = components.map((component) => ({
    component,
    match: matchComponent(component, intersections),
  }));
  return { intersections, streets, downtownPolygons, osmComponents };
}

