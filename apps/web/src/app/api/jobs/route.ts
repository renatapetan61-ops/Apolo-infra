import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const runtime = "nodejs";
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const jobs = await sql`SELECT id,infrastructure_id,action,status,error,result,created_at,started_at,finished_at
    FROM jobs WHERE owner_id=${userId} ORDER BY created_at DESC LIMIT 50`;
  const workers = await sql`SELECT worker_id,engine,hostname,gateway_url,status,last_seen_at FROM workers ORDER BY last_seen_at DESC LIMIT 10`;
  return NextResponse.json({ jobs, workers });
}