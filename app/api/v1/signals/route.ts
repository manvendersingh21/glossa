import { NextResponse } from "next/server";

import { apiErrorResponse } from "@/lib/server/api-error";
import { CACHE_CONTROL, PROVENANCE_HEADERS } from "@/lib/server/cache";
import { parseSignalFilters } from "@/lib/server/filters";
import { getSignals } from "@/lib/server/signals";

export const runtime = "nodejs";
export const revalidate = 300;

export async function GET(request: Request) {
  try {
    const filters = parseSignalFilters(new URL(request.url).searchParams);
    const collection = await getSignals(filters);
    return NextResponse.json(collection, {
      headers: { "Cache-Control": CACHE_CONTROL, ...PROVENANCE_HEADERS },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
