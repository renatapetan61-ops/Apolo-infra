import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 30;
const createSchema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,62}$/),
  image: z.string().min(1).max(255).regex(/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]*$/).optional(),
}).strict();
const MAX_SOURCE_BYTES = 3 * 1024 * 1024;

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rows = await sql`SELECT id,name,image,container_port,status,engine,container_id,host_port,last_error,last_result,created_at,updated_at
    FROM infrastructures WHERE owner_id=${userId} AND status <> 'deleted' ORDER BY created_at DESC`;
  return NextResponse.json({ infrastructures: rows.map(row => ({ ...row, last_result: row.last_result ? JSON.parse(String(row.last_result)) : null })) });
}

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let input: { name: string; image?: string };
  let sourceArchiveBase64: string | undefined;
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const parsed = createSchema.safeParse({ name: form.get("name") });
    if (!parsed.success) return NextResponse.json({ error: "invalid request", details: parsed.error.flatten() }, { status: 400 });
    const file = form.get("source");
    if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Selecione um arquivo ZIP com o código-fonte." }, { status: 400 });
    if (file.size > MAX_SOURCE_BYTES) return NextResponse.json({ error: "O ZIP deve ter no máximo 3 MB. Para projetos maiores, use um repositório Git." }, { status: 413 });
    if (!file.name.toLowerCase().endsWith(".zip")) return NextResponse.json({ error: "Envie o código-fonte em um arquivo .zip." }, { status: 400 });
    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return NextResponse.json({ error: "O arquivo enviado não parece ser um ZIP válido." }, { status: 400 });
    input = parsed.data;
    sourceArchiveBase64 = bytes.toString("base64");
  } else {
    const parsed = createSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success || !parsed.data.image) return NextResponse.json({ error: "Informe o nome e selecione uma imagem Docker/Podman." }, { status: 400 });
    input = parsed.data;
  }
  const image = sourceArchiveBase64 ? `apolo-build/${input.name.toLowerCase()}:latest` : input.image!;
  const payload = { name: input.name, image, ...(sourceArchiveBase64 ? { source_archive_base64: sourceArchiveBase64 } : {}) };
  const id = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  await sql`INSERT INTO infrastructures(id,owner_id,name,image,container_port,status)
    VALUES(${id},${userId},${input.name},${image},8080,'queued')`;
  const jobs = await sql`INSERT INTO jobs(id,owner_id,infrastructure_id,action,payload,status)
    VALUES(${jobId},${userId},${id},'create',${JSON.stringify(payload)},'queued')
    RETURNING id,infrastructure_id,action,status,created_at`;
  return NextResponse.json({ job: jobs[0], source_upload: Boolean(sourceArchiveBase64) }, { status: 202 });
}
