import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "@/lib/db";

export const runtime = "nodejs";
const createSchema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,62}$/),
  image: z.string().min(1).max(255).regex(/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]*$/),
  container_port: z.number().int().min(1).max(65535),
}).strict();

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rows = await sql`SELECT id,name,image,container_port,status,engine,container_id,host_port,last_error,last_result,created_at,updated_at
    FROM infrastructures WHERE owner_id=${userId} AND status <> 'deleted' ORDER BY created_at DESC`;
  return NextResponse.json({ infrastructures: rows });
}

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid request", details: parsed.error.flatten() }, { status: 400 });
  const input = parsed.data;
  const id = crypto.randomUUID();
  const rows = await sql`WITH created AS (
      INSERT INTO infrastructures(id,owner_id,name,image,container_port,status)
      VALUES(${id},${userId},${input.name},${input.image},${input.container_port},'queued')
      RETURNING id
    )
    INSERT INTO jobs(owner_id,infrastructure_id,action,payload,status)
    SELECT ${userId}, id, 'create', ${JSON.stringify(input)}::jsonb, 'queued' FROM created
    RETURNING id, infrastructure_id, action, status, created_at`;
  return NextResponse.json({ job: rows[0] }, { status: 202 });
}