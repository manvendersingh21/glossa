export type TimingKind =
  | "current_official"
  | "stale_official"
  | "observed"
  | "modeled"
  | "unknown";

export type Confidence = "high" | "medium" | "low" | "unknown";

export interface TimingSummary {
  kind: TimingKind;
  cycleSeconds: number | null;
  cycleRangeSeconds: [number, number] | null;
  cyclesPerHourRange: [number, number] | null;
  confidence: Confidence;
  modelVersion: string | null;
  rationale: string[];
  sourceUrl: string | null;
  sourceAsOf: string | null;
}

export interface SignalProperties {
  id: string;
  cnn: string;
  signalNumber: string | null;
  name: string;
  downtown: boolean;
  type: string | null;
  detection: string | null;
  vehicleActuated: boolean | null;
  pedestrianSignal: boolean | null;
  pedestrianActuated: boolean | null;
  accessiblePedestrianSignal: boolean | null;
  transitPriority: boolean | null;
  emergencyPreemption: boolean | null;
  redLightCamera: boolean | null;
  osmComponentCount: number;
  timing: TimingSummary;
  inventoryAsOf: string | null;
  osmAsOf: string | null;
}

export interface SignalFeature {
  type: "Feature";
  id: string;
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: SignalProperties;
}

export interface SignalFeatureCollection {
  type: "FeatureCollection";
  features: SignalFeature[];
  meta: {
    count: number;
    nextCursor: string | null;
    generatedAt: string;
    sources: Array<{ name: string; asOf: string | null; url: string }>;
    attribution: string[];
  };
}

export interface AreaStats {
  area: "sf" | "downtown";
  signalCount: number;
  areaSquareMiles: number;
  roadMiles: number;
  signalsPerSquareMile: number;
  signalsPerRoadMile: number;
  medianNearestSignalFeet: number | null;
  timingCoveragePercent: number;
  officialTimingPercent: number;
  modeledTimingPercent: number;
  generatedAt: string;
}
