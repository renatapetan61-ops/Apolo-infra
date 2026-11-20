import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const runtime = "nodejs";
export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const rows = await sql`SELECT id,name FROM infrastructures WHERE id=${id} AND owner_id=${userId} AND status <> 'deleted'`;
  if (!rows.length) return NextResponse.json({ error: "infrastructure not found" }, { status: 404 });
  const jobId = crypto.randomUUID();
  const jobs = await sql`INSERT INTO jobs(id,owner_id,infrastructure_id,action,payload,status)
    VALUES(${jobId},${userId},${id},'delete',${JSON.stringify({name:rows[0].name})},'queued')
    RETURNING id,infrastructure_id,action,status,created_at`;
  await sql`UPDATE infrastructures SET status='deleting',updated_at=CURRENT_TIMESTAMP WHERE id=${id}`;
  return NextResponse.json({ job: jobs[0] }, { status: 202 });
}
