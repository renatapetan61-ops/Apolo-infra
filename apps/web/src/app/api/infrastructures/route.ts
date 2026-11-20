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
const MAX_SOURCE_FILES = 1000;
const IGNORED = new Set([".git","node_modules",".next","dist","build","coverage",".venv","venv","__pycache__"]);

function validRelativePath(value:string) {
  const normalized=value.replace(/\\/g,"/");
  return Boolean(normalized) && !normalized.startsWith("/") && !/^[a-zA-Z]:/.test(normalized)
    && !normalized.includes("\0") && !normalized.split("/").some(part=>!part||part==="."||part===".."||IGNORED.has(part));
}

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
  let sourceFiles: { path:string; content_base64:string }[] | undefined;
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const parsed = createSchema.safeParse({ name: form.get("name") });
    if (!parsed.success) return NextResponse.json({ error: "Nome de infraestrutura inválido.", details: parsed.error.flatten() }, { status: 400 });
    const files = form.getAll("sourceFiles").filter((entry):entry is File=>entry instanceof File);
    const paths = form.getAll("sourcePaths").filter((entry):entry is string=>typeof entry==="string");
    if (!files.length || files.length!==paths.length) return NextResponse.json({ error: "Selecione uma pasta de projeto com arquivos." }, { status: 400 });
    if (files.length > MAX_SOURCE_FILES) return NextResponse.json({ error: "A pasta contém mais de 1.000 arquivos. Remova dependências e arquivos gerados." }, { status: 413 });
    let totalBytes=0;
    sourceFiles=[];
    for(let index=0;index<files.length;index++){
      const file=files[index], relativePath=paths[index];
      if(!validRelativePath(relativePath)) return NextResponse.json({error:"A pasta contém um caminho de arquivo inválido ou não permitido."},{status:400});
      totalBytes+=file.size;
      if(totalBytes>MAX_SOURCE_BYTES) return NextResponse.json({error:"A pasta selecionada ultrapassa o limite atual de 3 MB."},{status:413});
      if(file.size===0) continue;
      sourceFiles.push({path:relativePath,content_base64:Buffer.from(await file.arrayBuffer()).toString("base64")});
    }
    if(!sourceFiles.length) return NextResponse.json({error:"A pasta não contém arquivos válidos."},{status:400});
    input=parsed.data;
  } else {
    const parsed = createSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success || !parsed.data.image) return NextResponse.json({ error: "Informe o nome e selecione uma imagem Docker/Podman." }, { status: 400 });
    input = parsed.data;
  }
  const image = sourceFiles ? `apolo-build/${input.name.toLowerCase()}:latest` : input.image!;
  const payload = { name: input.name, image, ...(sourceFiles ? { source_files: sourceFiles } : {}) };
  const id = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  await sql`INSERT INTO infrastructures(id,owner_id,name,image,internal_port,container_port,status)
    VALUES(${id},${userId},${input.name},${image},8080,8080,'queued')`;
  const jobs = await sql`INSERT INTO jobs(id,owner_id,infrastructure_id,action,payload,status)
    VALUES(${jobId},${userId},${id},'create',${JSON.stringify(payload)},'queued')
    RETURNING id,infrastructure_id,action,status,created_at`;
  return NextResponse.json({ job: jobs[0], source_upload: Boolean(sourceFiles), source_file_count: sourceFiles?.length||0 }, { status: 202 });
}
