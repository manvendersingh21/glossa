import { z } from "zod";

import { ApiError } from "@/lib/server/api-error";

const cursorSchema = z.object({
  v: z.literal(1),
  id: z.string().min(1).max(512),
});

export function encodeCursor(id: string): string {
  return Buffer.from(JSON.stringify({ v: 1, id }), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): string {
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const result = cursorSchema.safeParse(JSON.parse(decoded) as unknown);
    if (!result.success) {
      throw new Error("invalid cursor payload");
    }
    return result.data.id;
  } catch {
    throw new ApiError(
      400,
      "invalid_cursor",
      "cursor is invalid or was created by an incompatible API version.",
    );
  }
}

