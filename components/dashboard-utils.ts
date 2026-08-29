import type { SignalFeature, TimingKind } from "@/lib/contracts";

export type Area = "downtown" | "sf";
export type LayerMode = "clusters" | "heatmap" | "points";
export type TimingFilter = "official" | "observed" | "modeled" | "unknown";
export type CapabilityFilter =
  | "all"
  | "vehicleActuated"
  | "pedestrianSignal"
  | "pedestrianActuated"
  | "accessiblePedestrianSignal"
  | "transitPriority"
  | "emergencyPreemption"
  | "redLightCamera";

export const TIMING_FILTERS: Array<{
  value: TimingFilter;
  label: string;
  description: string;
  kinds: TimingKind[];
}> = [
  {
    value: "official",
    label: "Official",
    description: "Published by an agency",
    kinds: ["current_official", "stale_official"],
  },
  {
    value: "observed",
    label: "Observed",
    description: "Documented observation",
    kinds: ["observed"],
  },
  {
    value: "modeled",
    label: "Modeled",
    description: "An estimate, not an official plan",
    kinds: ["modeled"],
  },
  {
    value: "unknown",
    label: "Unknown",
    description: "No timing available",
    kinds: ["unknown"],
  },
];

export const CAPABILITY_FILTERS: Array<{ value: CapabilityFilter; label: string }> = [
  { value: "all", label: "All capabilities" },
  { value: "vehicleActuated", label: "Vehicle actuation" },
  { value: "pedestrianSignal", label: "Pedestrian signal" },
  { value: "pedestrianActuated", label: "Pedestrian actuation" },
  { value: "accessiblePedestrianSignal", label: "Accessible pedestrian signal" },
  { value: "transitPriority", label: "Transit priority" },
  { value: "emergencyPreemption", label: "Emergency preemption" },
  { value: "redLightCamera", label: "Red-light camera" },
];

export const TIMING_COLORS: Record<TimingKind, string> = {
  current_official: "#087f72",
  stale_official: "#5c8b7c",
  observed: "#4e67ad",
  modeled: "#cf762d",
  unknown: "#787875",
};

export function signalsApiUrl(area: Area): string {
  const parameters = new URLSearchParams({ limit: "2000" });
  if (area === "downtown") parameters.set("downtown", "true");
  return `/api/v1/signals?${parameters.toString()}`;
}

export function timingFilterForKind(kind: TimingKind): TimingFilter {
  if (kind === "current_official" || kind === "stale_official") return "official";
  return kind;
}

export function timingLabel(kind: TimingKind): string {
  switch (kind) {
    case "current_official":
      return "Official · published";
    case "stale_official":
      return "Official · archived";
    case "observed":
      return "Observed";
    case "modeled":
      return "Modeled estimate";
    case "unknown":
      return "Timing unknown";
  }
}

export function timingExplanation(kind: TimingKind): string {
  switch (kind) {
    case "current_official":
      return "Published agency timing. It is a dated record, not a live controller reading.";
    case "stale_official":
      return "Published agency timing from an older record. Current operation may differ.";
    case "observed":
      return "A documented observation, not a current official timing plan.";
    case "modeled":
      return "An analytical estimate. It is not an agency-published signal plan.";
    case "unknown":
      return "No published, observed, or modeled timing is available in this snapshot.";
  }
}

export function filterSignals(
  signals: SignalFeature[],
  timingFilters: ReadonlySet<TimingFilter>,
  capability: CapabilityFilter,
): SignalFeature[] {
  return signals.filter((signal) => {
    const timingMatch = timingFilters.has(timingFilterForKind(signal.properties.timing.kind));
    const capabilityMatch = capability === "all" || signal.properties[capability] === true;
    return timingMatch && capabilityMatch;
  });
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "Date not reported";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function formatNumber(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

export function formatCycle(signal: SignalFeature): string {
  const { cycleSeconds, cycleRangeSeconds } = signal.properties.timing;
  if (cycleSeconds !== null) return `${formatNumber(cycleSeconds)} sec`;
  if (cycleRangeSeconds) {
    return `${formatNumber(cycleRangeSeconds[0])}–${formatNumber(cycleRangeSeconds[1])} sec`;
  }
  return "Not available";
}

export function safeExternalUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}
