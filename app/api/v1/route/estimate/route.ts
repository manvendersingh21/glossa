import { NextResponse } from "next/server";
import { ApiError } from "@/lib/server/api-error";
import { estimateRoute, routeEstimateRequestSchema } from "@/lib/server/route-estimate";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const input = routeEstimateRequestSchema.parse(await request.json());
    return NextResponse.json(await estimateRoute(input), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ApiError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    return NextResponse.json({ error: { code: "invalid_request", message: "Provide valid origin and destination values." } }, { status: 400 });
  }
}
