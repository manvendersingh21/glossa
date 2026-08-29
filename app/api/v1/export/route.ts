import { NextResponse } from "next/server";

import { apiErrorResponse } from "@/lib/server/api-error";
import { CACHE_CONTROL, PROVENANCE_HEADERS } from "@/lib/server/cache";
import { signalsToCsv } from "@/lib/server/csv";
import { parseExportQuery } from "@/lib/server/filters";
import { getSignalsForExport } from "@/lib/server/signals";

export const runtime = "nodejs";
export const revalidate = 300;

const MAXIMUM_EXPORT_ROWS = 50_000;

export async function GET(request: Request) {
  try {
    const parsed = parseExportQuery(new URL(request.url).searchParams);
    const collection = await getSignalsForExport(parsed, MAXIMUM_EXPORT_ROWS);
    const commonHeaders = {
      "Cache-Control": CACHE_CONTROL,
      "Content-Disposition": `attachment; filename="glossa-signals.${
        parsed.format === "csv" ? "csv" : "geojson"
      }"`,
      "X-Content-Type-Options": "nosniff",
      "X-Glossa-Attribution": "SFMTA via DataSF; OpenStreetMap contributors",
      ...PROVENANCE_HEADERS,
    };

    if (parsed.format === "csv") {
      return new NextResponse(signalsToCsv(collection.features), {
        headers: {
          ...commonHeaders,
          "Content-Type": "text/csv; charset=utf-8",
        },
      });
    }

    return NextResponse.json(collection, {
      headers: {
        ...commonHeaders,
        "Content-Type": "application/geo+json; charset=utf-8",
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
