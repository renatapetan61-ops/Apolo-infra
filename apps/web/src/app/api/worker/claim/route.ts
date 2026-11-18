import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { isWorkerAuthorized } from "@/lib/worker-auth";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  if (!isWorkerAuthorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body.worker_id !== "string") return NextResponse.json({ error: "invalid worker payload" }, { status: 400 });
  const rows = await sql`WITH stale AS (
      UPDATE jobs SET status='queued', worker_id=NULL, started_at=NULL, heartbeat_at=NULL, updated_at=now()
      WHERE status='running' AND updated_at < now() - interval '15 minutes'
      RETURNING id
    ), candidate AS (
      SELECT id FROM jobs
      WHERE status='queued' OR id IN (SELECT id FROM stale)
      ORDER BY created_at ASC FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE jobs SET status='running', worker_id=${body.worker_id}, started_at=now(), heartbeat_at=now(), updated_at=now()
    WHERE id=(SELECT id FROM candidate)
    RETURNING id, action, payload, created_at`;
  if (!rows.length) return NextResponse.json({ job: null });
  return NextResponse.json({ job: rows[0] });
}