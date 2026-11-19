import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { isWorkerAuthorized } from "@/lib/worker-auth";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  if (!isWorkerAuthorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body.worker_id !== "string" || body.worker_id.length > 128) return NextResponse.json({ error: "invalid worker payload" }, { status: 400 });
  await sql`UPDATE jobs SET status='queued',worker_id=NULL,started_at=NULL,heartbeat_at=NULL,updated_at=CURRENT_TIMESTAMP
    WHERE status='running' AND updated_at < datetime('now','-15 minutes')`;
  const rows = await sql`UPDATE jobs SET status='running',worker_id=${body.worker_id},started_at=CURRENT_TIMESTAMP,
    heartbeat_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
    WHERE id=(SELECT id FROM jobs WHERE status='queued' ORDER BY created_at ASC LIMIT 1)
    RETURNING id,action,payload,created_at`;
  if (!rows.length) return NextResponse.json({ job: null });
  return NextResponse.json({ job: { ...rows[0], payload: JSON.parse(String(rows[0].payload || "{}")) } });
}
