import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { isWorkerAuthorized } from "@/lib/worker-auth";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  if (!isWorkerAuthorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body.worker_id !== "string" || body.worker_id.length > 128) return NextResponse.json({ error: "invalid worker payload" }, { status: 400 });
  const engine = body.engine === "podman" ? "podman" : body.engine === "docker" ? "docker" : "unknown";
  const gatewayUrl = typeof body.gateway_url === "string" && /^https:\/\/[a-z0-9-]+-8080\\.app\\.github\\.dev$/i.test(body.gateway_url) ? body.gateway_url : null;
  await sql`INSERT INTO workers(worker_id, engine, hostname, gateway_url, status, last_seen_at)
    VALUES(${body.worker_id}, ${engine}, ${String(body.hostname || "").slice(0,128)}, ${gatewayUrl}, 'online', now())
    ON CONFLICT(worker_id) DO UPDATE SET engine=EXCLUDED.engine, hostname=EXCLUDED.hostname, gateway_url=EXCLUDED.gateway_url, status='online', last_seen_at=now()`;
  return NextResponse.json({ ok: true, server_time: new Date().toISOString() });
}