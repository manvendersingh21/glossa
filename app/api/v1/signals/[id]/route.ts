import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiError, apiErrorResponse } from "@/lib/server/api-error";
import { CACHE_CONTROL, PROVENANCE_HEADERS } from "@/lib/server/cache";
import { getSignalById } from "@/lib/server/signals";

export const runtime = "nodejs";
export const revalidate = 300;

const idSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/);

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const params = await context.params;
    const parsed = idSchema.safeParse(params.id);
    if (!parsed.success) {
      throw new ApiError(400, "invalid_path", "The signal id is invalid.");
    }

    const signal = await getSignalById(parsed.data);
    return NextResponse.json(signal, {
      headers: { "Cache-Control": CACHE_CONTROL, ...PROVENANCE_HEADERS },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
