import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
export const runtime = "nodejs";
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({error:"unauthorized"},{status:401});
  const [infra, jobs, workers] = await Promise.all([
    sql`SELECT count(*) AS count FROM infrastructures WHERE owner_id=${userId} AND status <> 'deleted'`,
    sql`SELECT count(*) AS count FROM jobs WHERE owner_id=${userId}`,
    sql`SELECT count(*) AS count FROM workers WHERE status='online' AND last_seen_at > datetime('now','-60 seconds')`
  ]);
  return NextResponse.json({infrastructures:Number(infra[0].count),jobs:Number(jobs[0].count),workers:Number(workers[0].count)});
}
