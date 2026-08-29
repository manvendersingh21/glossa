import { NextResponse } from "next/server";

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta: {
    generatedAt: string;
  };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function apiErrorResponse(error: unknown): NextResponse<ErrorBody> {
  const apiError =
    error instanceof ApiError
      ? error
      : new ApiError(
          500,
          "internal_error",
          "The request could not be completed.",
        );

  const body: ErrorBody = {
    error: {
      code: apiError.code,
      message: apiError.message,
      ...(apiError.details === undefined ? {} : { details: apiError.details }),
    },
    meta: { generatedAt: new Date().toISOString() },
  };

  return NextResponse.json(body, {
    status: apiError.status,
    headers: { "Cache-Control": "no-store" },
  });
}

