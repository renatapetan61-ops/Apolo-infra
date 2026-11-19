"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { UserButton } from "@clerk/nextjs";
import ShinyText from "@/components/reactbits/ShinyText";

type Infra = { id:string; name:string; image:string; container_port:number; hostname?:string|null; status:string; engine?:string|null; host_port?:number|null; last_error?:string|null; last_result?:{gateway?:{url?:string|null;path?:string}}|null };
type Job = { id:string; action:string; status:string; error?:string|null; created_at:string };
type Worker = { worker_id:string; engine:string; hostname:string; status:string; last_seen_at:string };
type ImageOption = { name:string; reference:string; tag:string; updated_at:string|null; description:string; pull_count:number; source:string };
type SourceFile = File & { webkitRelativePath?: string };

const ignored = new Set([".git","node_modules",".next","dist","build","coverage",".venv","venv","__pycache__"]);
const formatBytes = (bytes:number) => bytes < 1024 ? bytes+" B" : bytes < 1024*1024 ? (bytes/1024).toFixed(1)+" KB" : (bytes/1024/1024).toFixed(2)+" MB";
const statusLabel:Record<string,string> = { queued:"Na fila", running:"Em execução", deleting:"Removendo", deleted:"Removida", error:"Erro", succeeded:"Concluído", failed:"Falhou" };

export function Dashboard({ previewMode = false }: { previewMode?: boolean }) {
  const [items,setItems] = useState<Infra[]>([]);
  const [jobs,setJobs] = useState<Job[]>([]);
  const [workers,setWorkers] = useState<Worker[]>([]);
  const [name,setName] = useState("apolo-app");
  const [mode,setMode] = useState<"image"|"source">("image");
  const [query,setQuery] = useState("");
  const [images,setImages] = useState<ImageOption[]>([]);
  const [image,setImage] = useState("");
  const [sourceFiles,setSourceFiles] = useState<SourceFile[]>([]);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState("");
  const [catalogError,setCatalogError] = useState("");
  const folderInput = useRef<HTMLInputElement>(null);
  const refresh = useCallback(async () => {
    const [a,b] = await Promise.all([fetch("/api/infrastructures"),fetch("/api/jobs")]);
    if(a.ok){const data=await a.json();setItems(data.infrastructures||[]);}
    if(b.ok){const data=await b.json();setJobs(data.jobs||[]);setWorkers(data.workers||[]);}
  },[]);
  const loadImages = useCallback(async (term:string) => {
    setCatalogError("");
    try {
      const r=await fetch("/api/images?q="+encodeURIComponent(term));
      const d=await r.json();
      if(!r.ok) throw new Error(d.error||"Falha ao consultar o catálogo.");
      const found:ImageOption[]=d.images||[];
      setImages(found);
      setImage(current=>found.some(item=>item.reference===current)?current:(found[0]?.reference||""));
    } catch(e) { setCatalogError(e instanceof Error?e.message:"Falha ao carregar imagens."); }
  },[]);
  useEffect(()=>{if(previewMode)return;void refresh();const t=setInterval(()=>void refresh(),5000);return()=>clearInterval(t);},[refresh,previewMode]);
  useEffect(()=>{if(!previewMode&&mode==="image")void loadImages(query);},[mode,query,loadImages,previewMode]);

  const onlineWorkers = workers.filter(w=>Date.now()-new Date(w.last_seen_at).getTime()<60000).length;
  const running = items.filter(i=>i.status==="running").length;
  const pendingJobs = jobs.filter(j=>j.status==="queued"||j.status==="running").length;
  const selectedSize = useMemo(()=>sourceFiles.reduce((sum,file)=>sum+file.size,0),[sourceFiles]);
  const selectedFolder = sourceFiles[0]?.webkitRelativePath?.split("/")[0] || "";

  function chooseFolder(list:FileList|null) {
    if(!list) return;
    const files = Array.from(list as FileList).filter(file => {
      const relative = (file as SourceFile).webkitRelativePath || file.name;
      return !relative.split("/").some(part=>ignored.has(part));
    }) as SourceFile[];
    setSourceFiles(files);
    setMessage("");
  }

  async function create(e:React.FormEvent){
    e.preventDefault();setBusy(true);setMessage("");
    try{
      let r:Response;
      if(mode==="source"){
        if(!sourceFiles.length)throw new Error("Escolha a pasta do projeto.");
        if(selectedSize>3*1024*1024)throw new Error("A pasta selecionada ultrapassa o limite atual de 3 MB.");
        if(sourceFiles.length>1000)throw new Error("A pasta contém mais de 1.000 arquivos. Remova dependências e arquivos gerados.");
        const form=new FormData();form.set("name",name);
        for(const file of sourceFiles){
          const relative=(file.webkitRelativePath||file.name).split("/").slice(1).join("/") || file.name;
          form.append("sourcePaths",relative);
          form.append("sourceFiles",file,file.name);
        }
        r=await fetch("/api/infrastructures",{method:"POST",body:form});
      }else{
        if(!image)throw new Error("Selecione uma imagem Docker/Podman.");
        r=await fetch("/api/infrastructures",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name,image})});
      }
      const d=await r.json();if(!r.ok)throw new Error(d.error||"Falha ao criar");
      setMessage("Solicitação enviada ao worker. A porta interna será identificada e a porta do host será alocada automaticamente.");
      setSourceFiles([]);if(folderInput.current)folderInput.current.value="";
      await refresh();
    }catch(err){setMessage(err instanceof Error?err.message:"Erro inesperado");}
    finally{setBusy(false);}
  }

  async function remove(id:string){
    if(!confirm("Agendar a remoção desta infraestrutura?"))return;
    const r=await fetch("/api/infrastructures/"+id,{method:"DELETE"});const d=await r.json();
    setMessage(r.ok?"Remoção enviada ao executor.":d.error||"Falha");await refresh();
  }

  return <main className="app-shell">
    <aside className="sidebar">
      <a className="brand-lockup" href="/dashboard"><span className="brand-mark">A</span><span><strong>APOLO<span>INFRA</span></strong><small>CONTROL PLANE</small></span></a>
      <div className="side-label">WORKSPACE</div>
      <a className="side-link active" href="#overview"><span>◫</span> Visão geral</a>
      <a className="side-link" href="#infrastructures"><span>▤</span> Infraestruturas <b>{items.length}</b></a>
      <a className="side-link" href="#workers"><span>⌘</span> Workers</a>
      <a className="side-link" href="#jobs"><span>◷</span> Fila de execução</a>
      <div className="sidebar-bottom"><div className="system-indicator"><i/> <span>Sistema de controle</span><b>ONLINE</b></div><p>APOLO INFRA · v0.2</p><a href="https://reactbits.dev/" target="_blank" rel="noreferrer">Motion UI by React Bits ↗</a></div>
    </aside>

    <div className="main-area">
      <header className="topbar">
        <div className="breadcrumb">Workspace <span>/</span> <strong>Visão geral</strong></div>
        <div className="top-actions">{previewMode&&<span className="preview-mode-label">PRÉVIA VISUAL · SOMENTE LEITURA</span>}<span className="secure-label"><i/> {previewMode?"Autenticação pendente":"Conexão protegida"}</span>{!previewMode&&<UserButton />}</div>
      </header>

      <div className="page-content" id="overview">{previewMode&&<div className="notice preview-notice">Prévia visual do novo APOLO INFRA. Este ambiente Vercel não tem as chaves Clerk de Preview; os dados e comandos estão desativados. A autenticação e a operação continuam protegidas.</div> }
        <section className="welcome-row">
          <div><div className="eyebrow"><span className="eyebrow-dot"/> INFRASTRUCTURE ORCHESTRATION</div><h1>Seu ambiente.<br/><ShinyText color="#8cc8ff" shineColor="#e8fbff" speed={5} trigger="loop">Seu controle.</ShinyText></h1><p>Provisione, publique e gerencie aplicações em um único plano de controle.</p></div>
          <a className="primary-cta" href="#create"><span>＋</span> Nova infraestrutura</a>
        </section>

        <section className="metrics-grid">
          <article className="metric-card"><div className="metric-top"><span>Infraestruturas</span><span className="metric-icon">▤</span></div><strong>{items.length.toString().padStart(2,"0")}</strong><small>Total cadastrado</small><div className="metric-foot"><span className="tiny-dot blue"/> {running} em execução</div></article>
          <article className="metric-card"><div className="metric-top"><span>Workers ativos</span><span className="metric-icon">⌘</span></div><strong>{onlineWorkers.toString().padStart(2,"0")}</strong><small>Heartbeat recente</small><div className="metric-foot"><span className="tiny-dot green"/> {workers.length} registrados</div></article>
          <article className="metric-card"><div className="metric-top"><span>Jobs pendentes</span><span className="metric-icon">◷</span></div><strong>{pendingJobs.toString().padStart(2,"0")}</strong><small>Fila de execução</small><div className="metric-foot"><span className="tiny-dot violet"/> Atualização automática</div></article>
          <article className="metric-card metric-highlight"><div className="metric-top"><span>Gateway</span><span className="metric-icon">⌁</span></div><strong className="gateway-state">Nginx</strong><small>Roteamento de aplicações</small><div className="metric-foot"><span className="tiny-dot green"/> Gerenciado pelo worker</div></article>
        </section>

        <section className="workspace-grid" id="create">
          <article className="surface create-panel">
            <div className="section-heading"><div><div className="eyebrow">DEPLOYMENT</div><h2>Criar infraestrutura</h2><p>Comece por uma imagem pronta ou envie uma pasta de projeto.</p></div><span className="step-badge">01 / 02</span></div>
            <form onSubmit={create}>
              <label className="field-label">Nome do ambiente<input className="text-input" value={name} onChange={e=>setName(e.target.value)} required minLength={3} maxLength={63} pattern="[a-zA-Z0-9][a-zA-Z0-9_-]{2,62}" placeholder="meu-projeto"/></label>
              <div className="mode-switch" role="tablist" aria-label="Origem da infraestrutura">
                <button type="button" className={mode==="image"?"mode-tab selected":"mode-tab"} onClick={()=>setMode("image")}><span>◈</span> Imagem Docker</button>
                <button type="button" className={mode==="source"?"mode-tab selected":"mode-tab"} onClick={()=>setMode("source")}><span>▱</span> Pasta do projeto</button>
              </div>
              {mode==="image"?<>
                <label className="field-label">Buscar no catálogo<input className="text-input" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar nginx, node, python, redis..."/></label>
                <label className="field-label">Imagem e versão<select className="text-input" value={image} onChange={e=>setImage(e.target.value)} required><option value="">Selecione uma imagem</option>{images.map(item=><option key={item.reference} value={item.reference}>{item.reference}{item.updated_at?" · "+new Date(item.updated_at).toLocaleDateString():""}</option>)}</select></label>
                {catalogError&&<p className="inline-error">{catalogError}</p>}
                {images.length>0&&<div className="image-meta"><span className="tiny-dot green"/> {images.find(item=>item.reference===image)?.description||"Imagem do catálogo público"} <span>· Docker Hub</span></div>}
                <button type="button" className="text-action" onClick={()=>void loadImages(query)}>↻ Atualizar catálogo</button>
              </>:<>
                <div className="folder-drop" onClick={()=>folderInput.current?.click()} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();const files=e.dataTransfer.files;if(files.length)chooseFolder(files);}}>
                  <input ref={folderInput} className="visually-hidden" type="file" multiple onChange={e=>chooseFolder(e.target.files)} {...({webkitdirectory:"",directory:""} as any)} />
                  <span className="folder-glyph">▱</span><strong>{selectedFilesLabel(sourceFiles.length,selectedFolder)}</strong>
                  <span>{sourceFiles.length?"Pasta carregada · clique para substituir":"Clique para selecionar a pasta completa do projeto"}</span>
                  <small>Pastas .git, node_modules e arquivos gerados são ignorados</small>
                  <span className="folder-button">Selecionar pasta</span>
                </div>
                {sourceFiles.length>0&&<div className="folder-summary"><span><b>{sourceFiles.length}</b> arquivos</span><span><b>{formatBytes(selectedSize)}</b> selecionados</span><button type="button" onClick={()=>{setSourceFiles([]);if(folderInput.current)folderInput.current.value="";}}>Limpar</button></div>}
                <p className="helper-copy">O APOLO detecta o Dockerfile ou identifica projetos Node.js, Python ASGI e sites estáticos para gerar a imagem automaticamente. Limite atual: 3 MB e 1.000 arquivos.</p>
              </>}
              <button className="submit-button" disabled={previewMode||busy||(mode==="image"&&!image)||(mode==="source"&&(!sourceFiles.length||selectedSize>3*1024*1024))}>{busy?<><span className="spinner"/> Enviando projeto...</>:<>Criar e iniciar <span>→</span></>}</button>
            </form>
            <div className="automation-note"><span>✦</span><p><b>Provisionamento automático</b><br/>Porta interna detectada · porta do host dinâmica · rota Nginx configurada pelo worker.</p></div>
            {message&&<div className={message.toLowerCase().includes("falha")||message.toLowerCase().includes("erro")?"notice error-notice":"notice"}>{message}</div>}
          </article>

          <aside className="right-column">
            <article className="surface architecture-card"><div className="section-heading compact"><div><div className="eyebrow">EXECUTION PIPELINE</div><h2>Fluxo de provisionamento</h2></div><span className="live-pill"><i/> LIVE</span></div>
              <div className="pipeline">
                <div className="pipeline-node"><span className="pipeline-icon">◫</span><div><b>Control Plane</b><small>Painel + API segura</small></div><span className="node-check">✓</span></div>
                <div className="pipeline-line"/>
                <div className="pipeline-node"><span className="pipeline-icon">⌘</span><div><b>Worker Codespaces</b><small>Docker / Podman</small></div><span className="node-check">↗</span></div>
                <div className="pipeline-line"/>
                <div className="pipeline-node"><span className="pipeline-icon">▦</span><div><b>Container runtime</b><small>Build, run e health</small></div><span className="node-check">↗</span></div>
                <div className="pipeline-line"/>
                <div className="pipeline-node"><span className="pipeline-icon">⌁</span><div><b>Nginx Gateway</b><small>Porta + rota pública</small></div><span className="node-check">↗</span></div>
              </div>
              <div className="pipeline-footer"><span className="tiny-dot green"/> Orquestração orientada a jobs</div>
            </article>
            <article className="surface worker-card" id="workers"><div className="section-heading compact"><div><div className="eyebrow">COMPUTE NODES</div><h2>Workers</h2></div><a href="#jobs" className="text-action">Ver fila ↗</a></div>
              {workers.length===0?<div className="empty-mini"><span>⌘</span><b>Nenhum worker conectado</b><small>Inicie seu Codespace para registrar o primeiro heartbeat.</small></div>:workers.slice(0,4).map(w=><div className="worker-row" key={w.worker_id}><span className="worker-avatar">⌘</span><div><b>{w.worker_id}</b><small>{w.engine} · {w.hostname}</small></div><span className={Date.now()-new Date(w.last_seen_at).getTime()<60000?"worker-online":"worker-offline"}>{Date.now()-new Date(w.last_seen_at).getTime()<60000?"ONLINE":"OFFLINE"}</span></div>)}
            </article>
          </aside>
        </section>

        <section className="surface table-panel" id="infrastructures"><div className="section-heading"><div><div className="eyebrow">RESOURCE INVENTORY</div><h2>Suas infraestruturas</h2><p>Ambientes provisionados e respectivos endpoints.</p></div><span className="count-label">{items.length} recursos</span></div>
          {items.length===0?<div className="empty-state"><span>▤</span><b>Nenhuma infraestrutura provisionada</b><p>Crie uma infraestrutura usando uma imagem Docker ou a pasta do seu projeto.</p><a href="#create">Começar agora →</a></div>:<div className="table-scroll"><table className="resource-table"><thead><tr><th>AMBIENTE</th><th>IMAGEM / ENGINE</th><th>PORTAS</th><th>STATUS</th><th>ENDPOINT</th><th/></tr></thead><tbody>{items.map(i=><tr key={i.id}><td><div className="resource-name"><span className="resource-icon">▦</span><b>{i.name}</b></div><small>{i.id.slice(0,8)}</small></td><td><b>{i.image}</b><small>{i.engine||"Aguardando worker"}</small></td><td><b>{i.host_port?":"+i.host_port:"—"}</b><small>interno {i.container_port||"auto"}</small></td><td><span className={"status-chip "+i.status}>{statusLabel[i.status]||i.status}</span>{i.last_error&&<small className="inline-error">{i.last_error}</small>}</td><td>{i.last_result?.gateway?.url?<a className="endpoint-link" href={i.last_result.gateway.url} target="_blank" rel="noreferrer">Abrir aplicação ↗</a>:<span className="muted-cell">Aguardando rota</span>}</td><td><button className="delete-button" disabled={previewMode} onClick={()=>void remove(i.id)} aria-label={"Excluir "+i.name}>×</button></td></tr>)}</tbody></table></div>}
        </section>

        <section className="surface jobs-panel" id="jobs"><div className="section-heading"><div><div className="eyebrow">JOB ORCHESTRATOR</div><h2>Atividade recente</h2><p>Solicitações processadas pelo worker.</p></div><span className="count-label">Últimos 50 jobs</span></div>
          {jobs.length===0?<div className="empty-mini"><span>◷</span><b>Nenhuma atividade registrada</b></div>:jobs.slice(0,8).map(j=><div className="job-row" key={j.id}><span className="job-symbol">{j.action==="delete"?"−":"＋"}</span><div><b>{j.action==="create"?"Criar infraestrutura":j.action==="delete"?"Remover infraestrutura":j.action}</b><small>{j.id.slice(0,12)} · {new Date(j.created_at).toLocaleString("pt-BR")}</small>{j.error&&<small className="inline-error">{j.error}</small>}</div><span className={"status-chip "+j.status}>{statusLabel[j.status]||j.status}</span></div>)}
        </section>
        <footer className="footer"><span>© {new Date().getFullYear()} APOLO INFRA</span><span>Infrastructure, orchestrated.</span></footer>
      </div>
    </div>
  </main>;
}

function selectedFilesLabel(count:number, folder:string) {
  if(!count) return "Nenhuma pasta selecionada";
  return folder ? folder : "Pasta de projeto selecionada";
}
