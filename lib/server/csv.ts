import type { SignalFeature } from "@/lib/contracts";

const CSV_HEADERS = [
  "id",
  "cnn",
  "signal_number",
  "name",
  "longitude",
  "latitude",
  "downtown",
  "type",
  "detection",
  "vehicle_actuated",
  "pedestrian_signal",
  "pedestrian_actuated",
  "accessible_pedestrian_signal",
  "transit_priority",
  "emergency_preemption",
  "red_light_camera",
  "osm_component_count",
  "timing_kind",
  "cycle_seconds",
  "cycle_min_seconds",
  "cycle_max_seconds",
  "confidence",
  "model_version",
  "timing_rationale",
  "timing_source_url",
  "timing_source_as_of",
  "inventory_as_of",
  "osm_as_of",
] as const;

function csvValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  let output = typeof value === "string" ? value : String(value);
  if (/^[=+\-@\t\r]/.test(output)) {
    output = `'${output}`;
  }

  if (/[",\r\n]/.test(output)) {
    return `"${output.replaceAll('"', '""')}"`;
  }
  return output;
}

function featureRow(feature: SignalFeature): unknown[] {
  const [longitude, latitude] = feature.geometry.coordinates;
  const { properties } = feature;
  const cycleRange = properties.timing.cycleRangeSeconds;

  return [
    feature.id,
    properties.cnn,
    properties.signalNumber,
    properties.name,
    longitude,
    latitude,
    properties.downtown,
    properties.type,
    properties.detection,
    properties.vehicleActuated,
    properties.pedestrianSignal,
    properties.pedestrianActuated,
    properties.accessiblePedestrianSignal,
    properties.transitPriority,
    properties.emergencyPreemption,
    properties.redLightCamera,
    properties.osmComponentCount,
    properties.timing.kind,
    properties.timing.cycleSeconds,
    cycleRange?.[0] ?? null,
    cycleRange?.[1] ?? null,
    properties.timing.confidence,
    properties.timing.modelVersion,
    properties.timing.rationale.join(" | "),
    properties.timing.sourceUrl,
    properties.timing.sourceAsOf,
    properties.inventoryAsOf,
    properties.osmAsOf,
  ];
}

export function signalsToCsv(features: SignalFeature[]): string {
  const rows = [
    CSV_HEADERS.map(csvValue).join(","),
    ...features.map((feature) => featureRow(feature).map(csvValue).join(",")),
  ];

  return `${rows.join("\r\n")}\r\n`;
}

