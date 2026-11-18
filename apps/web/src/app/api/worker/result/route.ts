import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { isWorkerAuthorized } from "@/lib/worker-auth";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  if (!isWorkerAuthorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body.job_id !== "string" || typeof body.worker_id !== "string" || !["succeeded","failed"].includes(body.status)) {
    return NextResponse.json({ error: "invalid result payload" }, { status: 400 });
  }
  const rows = await sql`UPDATE jobs SET status=${body.status}, result=${JSON.stringify(body.result ?? null)}::jsonb,
    error=${body.status === "failed" ? String(body.error || "worker failed").slice(0,4000) : null},
    finished_at=now(), updated_at=now()
    WHERE id=${body.job_id} AND worker_id=${body.worker_id} AND status='running'
    RETURNING id, infrastructure_id`;
  if (!rows.length) return NextResponse.json({ error: "job not found or lease not owned by worker" }, { status: 404 });
  if (body.status === "succeeded" && rows[0].infrastructure_id && body.result) {
    await sql`UPDATE infrastructures SET status=${body.result.deleted ? "deleted" : "running"},
      engine=${body.result.engine || null}, container_id=${body.result.container_id || null},
      host_port=${body.result.host_port || null}, last_result=${JSON.stringify(body.result)}::jsonb, updated_at=now()
      WHERE id=${rows[0].infrastructure_id}`;
  } else if (body.status === "failed" && rows[0].infrastructure_id) {
    await sql`UPDATE infrastructures SET status='error', last_error=${String(body.error || "worker failed").slice(0,4000)}, updated_at=now()
      WHERE id=${rows[0].infrastructure_id}`;
  }
  return NextResponse.json({ ok: true });
}