import { NextResponse } from "next/server";

import { apiErrorResponse } from "@/lib/server/api-error";
import { LONG_CACHE_CONTROL, PROVENANCE_HEADERS } from "@/lib/server/cache";
import { getAreaStats, parseStatsArea } from "@/lib/server/stats";

export const runtime = "nodejs";
export const revalidate = 3_600;

export async function GET(request: Request) {
  try {
    const area = parseStatsArea(new URL(request.url).searchParams);
    const stats = await getAreaStats(area);
    return NextResponse.json(stats, {
      headers: { "Cache-Control": LONG_CACHE_CONTROL, ...PROVENANCE_HEADERS },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
