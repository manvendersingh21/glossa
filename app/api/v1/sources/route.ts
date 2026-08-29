import { NextResponse } from "next/server";

import { ApiError, apiErrorResponse } from "@/lib/server/api-error";
import { LONG_CACHE_CONTROL, PROVENANCE_HEADERS } from "@/lib/server/cache";
import { getSources, PUBLIC_ATTRIBUTION } from "@/lib/server/sources";

export const runtime = "nodejs";
export const revalidate = 3_600;

export async function GET(request: Request) {
  try {
    if ([...new URL(request.url).searchParams].length > 0) {
      throw new ApiError(
        400,
        "invalid_query",
        "sources does not accept query parameters.",
      );
    }

    const sources = await getSources();
    return NextResponse.json(
      {
        sources,
        meta: {
          generatedAt: new Date().toISOString(),
          attribution: [...PUBLIC_ATTRIBUTION],
          liveData: false,
        },
      },
      {
        headers: { "Cache-Control": LONG_CACHE_CONTROL, ...PROVENANCE_HEADERS },
      },
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}
