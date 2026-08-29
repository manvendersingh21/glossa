import { z } from "zod";

import type { TimingKind } from "@/lib/contracts";
import { ApiError } from "@/lib/server/api-error";

export const CAPABILITIES = [
  "vehicleActuated",
  "pedestrianSignal",
  "pedestrianActuated",
  "accessiblePedestrianSignal",
  "transitPriority",
  "emergencyPreemption",
  "redLightCamera",
] as const;

export type Capability = (typeof CAPABILITIES)[number];
export type Bbox = [number, number, number, number];

export interface SignalFilters {
  bbox?: Bbox;
  downtown?: boolean;
  timingKind?: TimingKind;
  capability?: Capability;
  limit: number;
  cursor?: string;
}

export interface ExportQuery extends Omit<SignalFilters, "limit" | "cursor"> {
  format: "geojson" | "csv";
}

const timingKinds = [
  "current_official",
  "stale_official",
  "observed",
  "modeled",
  "unknown",
] as const;

const bboxSchema = z.string().transform((value, context): Bbox => {
  const pieces = value.split(",");
  const coordinates = pieces.map((piece) => Number(piece.trim()));
  const isFiniteBbox =
    coordinates.length === 4 &&
    pieces.every((piece) => piece.trim().length > 0) &&
    coordinates.every(Number.isFinite);

  if (!isFiniteBbox) {
    context.addIssue({
      code: "custom",
      message: "bbox must contain four comma-separated numbers",
    });
    return z.NEVER;
  }

  const [west, south, east, north] = coordinates;
  if (
    west < -180 ||
    east > 180 ||
    south < -90 ||
    north > 90 ||
    west >= east ||
    south >= north
  ) {
    context.addIssue({
      code: "custom",
      message:
        "bbox must be west,south,east,north within longitude/latitude bounds",
    });
    return z.NEVER;
  }

  return [west, south, east, north];
});

const limitSchema = z
  .string()
  .regex(/^\d+$/, "limit must be a positive integer")
  .transform(Number)
  .pipe(z.number().int().min(1).max(2_000));

const signalFilterSchema = z.object({
  bbox: bboxSchema.optional(),
  downtown: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  timingKind: z.enum(timingKinds).optional(),
  capability: z.enum(CAPABILITIES).optional(),
  limit: limitSchema.optional().default(500),
  cursor: z.string().min(1).max(1_024).optional(),
});

const exportSchema = z.object({
  bbox: bboxSchema.optional(),
  downtown: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  timingKind: z.enum(timingKinds).optional(),
  capability: z.enum(CAPABILITIES).optional(),
  format: z.enum(["geojson", "csv"]).optional().default("geojson"),
});

function collectQuery(
  searchParams: URLSearchParams,
  allowed: ReadonlySet<string>,
): Record<string, string> {
  const raw: Record<string, string> = {};

  for (const [key, value] of searchParams.entries()) {
    if (!allowed.has(key)) {
      throw new ApiError(400, "invalid_query", `Unknown query parameter: ${key}`);
    }
    if (key in raw) {
      throw new ApiError(
        400,
        "invalid_query",
        `Query parameter may only be supplied once: ${key}`,
      );
    }
    raw[key] = value;
  }

  return raw;
}

function validationDetails(error: z.ZodError): Array<{
  field: string;
  message: string;
}> {
  return error.issues.map((issue) => ({
    field: issue.path.join(".") || "query",
    message: issue.message,
  }));
}

export function parseSignalFilters(searchParams: URLSearchParams): SignalFilters {
  const allowed = new Set(Object.keys(signalFilterSchema.shape));
  const result = signalFilterSchema.safeParse(collectQuery(searchParams, allowed));

  if (!result.success) {
    throw new ApiError(
      400,
      "invalid_query",
      "One or more query parameters are invalid.",
      validationDetails(result.error),
    );
  }

  return result.data;
}

export function parseExportQuery(searchParams: URLSearchParams): ExportQuery {
  const allowed = new Set(Object.keys(exportSchema.shape));
  const result = exportSchema.safeParse(collectQuery(searchParams, allowed));

  if (!result.success) {
    throw new ApiError(
      400,
      "invalid_query",
      "One or more query parameters are invalid.",
      validationDetails(result.error),
    );
  }

  return result.data;
}
