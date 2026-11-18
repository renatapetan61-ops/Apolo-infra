import { timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";

export function isWorkerAuthorized(request: NextRequest) {
  const expected = process.env.APOLO_WORKER_TOKEN || "";
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}