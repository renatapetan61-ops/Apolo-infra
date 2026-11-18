"use client";
import { useCallback, useEffect, useState } from "react";
import { UserButton } from "@clerk/nextjs";

type Infra = { id:string; name:string; image:string; container_port:number; hostname?:string|null; status:string; engine?:string|null; host_port?:number|null; last_error?:string|null; last_result?:{gateway?:{url?:string|null;path?:string}}|null };
type Job = { id:string; action:string; status:string; error?:string|null; created_at:string };
type Worker = { worker_id:string; engine:string; hostname:string; status:string; last_seen_at:string };
type ImageOption = { name:string; reference:string; tag:string; updated_at:string|null; description:string; pull_count:number; source:string };

export function Dashboard() {
  const [items,setItems] = useState<Infra[]>([]);
  const [jobs,setJobs] = useState<Job[]>([]);
  const [workers,setWorkers] = useState<Worker[]>([]);
  const [name,setName] = useState("apolo-app");
  const [mode,setMode] = useState<"image"|"source">("image");
  const [query,setQuery] = useState("");
  const [images,setImages] = useState<ImageOption[]>([]);
  const [image,setImage] = useState("");
  const [source,setSource] = useState<File|null>(null);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState("");
  const [catalogError,setCatalogError] = useState("");
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
  useEffect(()=>{void refresh();const t=setInterval(()=>void refresh(),5000);return()=>clearInterval(t);},[refresh]);
  useEffect(()=>{if(mode==="image")void loadImages(query);},[mode,query,loadImages]);
  async function create(e:React.FormEvent){
    e.preventDefault();setBusy(true);setMessage("");
    try{
      let r:Response;
      if(mode==="source"){
        if(!source)throw new Error("Selecione o arquivo ZIP do código-fonte.");
        const form=new FormData();form.set("name",name);form.set("source",source);
        r=await fetch("/api/infrastructures",{method:"POST",body:form});
      }else{
        if(!image)throw new Error("Selecione uma imagem Docker/Podman.");
        r=await fetch("/api/infrastructures",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name,image})});
      }
      const d=await r.json();if(!r.ok)throw new Error(d.error||"Falha ao criar");
      setMessage("Solicitação enviada ao worker. A porta será detectada e atribuída automaticamente.");
      setSource(null);await refresh();
    }catch(err){setMessage(err instanceof Error?err.message:"Erro inesperado");}
    finally{setBusy(false);}
  }
  async function remove(id:string){if(!confirm("Agendar a remoção desta infraestrutura?"))return;const r=await fetch("/api/infrastructures/"+id,{method:"DELETE"});const d=await r.json();setMessage(r.ok?"Remoção enviada ao executor.":d.error||"Falha");await refresh();}
  return <main className="shell">
    <header className="top"><div><div className="brand">APOLO INFRA</div><div className="muted">Infrastructure Control Plane</div></div><UserButton /></header>
    <section className="grid">
      <article className="panel"><h2>Infraestruturas</h2><div className="stat">{items.length}</div><div className="muted">projetos cadastrados</div></article>
      <article className="panel"><h2>Jobs recentes</h2><div className="stat">{jobs.length}</div><div className="muted">últimos 50 trabalhos</div></article>
      <article className="panel"><h2>Workers conectados</h2><div className="stat">{workers.filter(w=>Date.now()-new Date(w.last_seen_at).getTime()<60000).length}</div><div className="muted">heartbeat nos últimos 60 segundos</div></article>
    </section>
    <section className="panel" style={{marginTop:16}}>
      <h2>Criar e iniciar infraestrutura</h2>
      <form className="form" onSubmit={create}>
        <label>Nome da infraestrutura<input value={name} onChange={e=>setName(e.target.value)} required minLength={3} maxLength={63} pattern="[a-zA-Z0-9][a-zA-Z0-9_-]{2,62}"/></label>
        <label>Origem da infraestrutura
          <select value={mode} onChange={e=>setMode(e.target.value as "image"|"source")}>
            <option value="image">Selecionar imagem Docker/Podman</option>
            <option value="source">Enviar código-fonte (ZIP)</option>
          </select>
        </label>
        {mode==="image"?<>
          <label>Buscar imagens no Docker Hub<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Ex.: nginx, node, python, redis"/></label>
          <label>Imagem e tag
            <select value={image} onChange={e=>setImage(e.target.value)} required>
              {images.map(item=><option key={item.reference} value={item.reference}>{item.reference}{item.updated_at?" · atualizada "+new Date(item.updated_at).toLocaleDateString():""}</option>)}
            </select>
          </label>
          {catalogError&&<p className="error">{catalogError}</p>}
          {images.length>0&&<p className="muted">{images.find(item=>item.reference===image)?.description} · catálogo público Docker Hub · tags recentes</p>}
          <button type="button" className="btn" onClick={()=>void loadImages(query)}>Atualizar catálogo</button>
        </>:<>
          <label>Arquivo ZIP do código-fonte<input type="file" accept=".zip,application/zip" onChange={e=>setSource(e.target.files?.[0]||null)} required/></label>
          <p className="muted">Envie um ZIP de até 3 MB contendo um Dockerfile na raiz ou um projeto com Dockerfile. O worker criará a imagem e iniciará o container. Para projetos maiores, use um repositório Git.</p>
        </>}
        <div><button className="btn" disabled={busy|| (mode==="image"&&!image) || (mode==="source"&&!source)}>{busy?"Enviando...":"Criar e iniciar"}</button></div>
      </form>
      <p className="muted">A porta interna será detectada pela configuração EXPOSE da imagem. A porta pública do host será alocada automaticamente e integrada ao gateway Nginx.</p>
      {message&&<p className={message.includes("Falha")?"error":"muted"}>{message}</p>}
    </section>
    <section className="panel" style={{marginTop:16}}><h2>Workers Codespaces</h2>{workers.length===0?<p className="muted">Nenhum Codespace enviou heartbeat ainda.</p>:workers.map(w=><div className="row" key={w.worker_id}><div><strong>{w.worker_id}</strong><div className="muted">{w.engine} · {w.hostname}</div></div><span className="pill">{Date.now()-new Date(w.last_seen_at).getTime()<60000?"online":"offline"}</span></div>)}</section>
    <section className="panel" style={{marginTop:16}}><h2>Infraestruturas</h2>{items.length===0?<p className="muted">Nenhuma infraestrutura cadastrada.</p>:items.map(i=><div className="row" key={i.id}><div><strong>{i.name}</strong><div className="muted">{i.image} · porta interna {i.container_port||"detectando"} · {i.engine||"aguardando worker"}</div>{i.host_port&&<div className="muted">Porta alocada no host: {i.host_port}</div>}{i.last_error&&<div className="error">{i.last_error}</div>}{i.last_result?.gateway?.url&&<div><a href={i.last_result.gateway.url} target="_blank" rel="noreferrer" style={{color:"#8fc4ff"}}>Abrir aplicação ↗</a></div>}</div><div style={{display:"flex",gap:10,alignItems:"center"}}><span className="pill">{i.status}</span><button className="btn" onClick={()=>void remove(i.id)}>Excluir</button></div></div>)}</section>
    <section className="panel" style={{marginTop:16}}><h2>Fila de execução</h2>{jobs.length===0?<p className="muted">Nenhuma execução registrada.</p>:jobs.map(j=><div className="row" key={j.id}><div><strong>{j.action}</strong><div className="mono">{j.id}</div>{j.error&&<div className="error">{j.error}</div>}</div><span className="pill">{j.status}</span></div>)}</section>
  </main>;
}
