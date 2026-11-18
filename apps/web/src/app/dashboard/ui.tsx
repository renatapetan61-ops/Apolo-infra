"use client";
import { useCallback, useEffect, useState } from "react";
import { UserButton } from "@clerk/nextjs";

type Infra = { id:string; name:string; image:string; container_port:number; hostname?:string|null; status:string; engine?:string|null; host_port?:number|null; last_error?:string|null; last_result?:{gateway?:{url?:string|null;path?:string}}|null };
type Job = { id:string; action:string; status:string; error?:string|null; created_at:string };
type Worker = { worker_id:string; engine:string; hostname:string; status:string; last_seen_at:string };

export function Dashboard() {
  const [items,setItems] = useState<Infra[]>([]);
  const [jobs,setJobs] = useState<Job[]>([]);
  const [workers,setWorkers] = useState<Worker[]>([]);
  const [name,setName] = useState("apolo-nginx");
  const [image,setImage] = useState("nginx:alpine");
  const [port,setPort] = useState("80");
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState("");
  const refresh = useCallback(async () => {
    const [a,b] = await Promise.all([fetch("/api/infrastructures"),fetch("/api/jobs")]);
    if(a.ok){const data=await a.json();setItems(data.infrastructures||[]);}
    if(b.ok){const data=await b.json();setJobs(data.jobs||[]);setWorkers(data.workers||[]);}
  },[]);
  useEffect(()=>{void refresh();const t=setInterval(()=>void refresh(),5000);return()=>clearInterval(t);},[refresh]);
  async function create(e:React.FormEvent){e.preventDefault();setBusy(true);setMessage("");try{const r=await fetch("/api/infrastructures",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name,image,container_port:Number(port)})});const d=await r.json();if(!r.ok)throw new Error(d.error||"Falha ao criar");setMessage("Solicitação enviada para o Codespace executor.");await refresh();}catch(err){setMessage(err instanceof Error?err.message:"Erro inesperado");}finally{setBusy(false);}}
  async function remove(id:string){if(!confirm("Agendar a remoção desta infraestrutura?"))return;const r=await fetch("/api/infrastructures/"+id,{method:"DELETE"});const d=await r.json();setMessage(r.ok?"Remoção enviada ao executor.":d.error||"Falha");await refresh();}
  return <main className="shell">
    <header className="top"><div><div className="brand">APOLO INFRA</div><div className="muted">Infrastructure Control Plane</div></div><UserButton /></header>
    <section className="grid">
      <article className="panel"><h2>Infraestruturas</h2><div className="stat">{items.length}</div><div className="muted">projetos cadastrados</div></article>
      <article className="panel"><h2>Jobs recentes</h2><div className="stat">{jobs.length}</div><div className="muted">últimos 50 trabalhos</div></article>
      <article className="panel"><h2>Workers conectados</h2><div className="stat">{workers.filter(w=>Date.now()-new Date(w.last_seen_at).getTime()<60000).length}</div><div className="muted">heartbeat nos últimos 60 segundos</div></article>
    </section>
    <section className="panel" style={{marginTop:16}}><h2>Criar infraestrutura</h2><form className="form" onSubmit={create}>
      <label>Nome<input value={name} onChange={e=>setName(e.target.value)} required minLength={3} maxLength={63}/></label>
      <label>Imagem Docker/Podman<input value={image} onChange={e=>setImage(e.target.value)} required/></label>
      <label>Porta do container<input value={port} onChange={e=>setPort(e.target.value)} type="number" min="1" max="65535" required/></label>
      <div style={{display:"flex",alignItems:"end"}}><button className="btn" disabled={busy}>{busy?"Enviando...":"Criar e iniciar"}</button></div>
    </form>{message&&<p className={message.includes("Falha")?"error":"muted"}>{message}</p>}</section>
    <section className="panel" style={{marginTop:16}}><h2>Workers Codespaces</h2>{workers.length===0?<p className="muted">Nenhum Codespace enviou heartbeat ainda.</p>:workers.map(w=><div className="row" key={w.worker_id}><div><strong>{w.worker_id}</strong><div className="muted">{w.engine} · {w.hostname}</div></div><span className="pill">{Date.now()-new Date(w.last_seen_at).getTime()<60000?"online":"offline"}</span></div>)}</section>
    <section className="panel" style={{marginTop:16}}><h2>Infraestruturas</h2>{items.length===0?<p className="muted">Nenhuma infraestrutura cadastrada.</p>:items.map(i=><div className="row" key={i.id}><div><strong>{i.name}</strong><div className="muted">{i.image} · porta {i.container_port} · {i.engine||"aguardando worker"}</div>{i.last_error&&<div className="error">{i.last_error}</div>}{i.last_result?.gateway?.url&&<div><a href={i.last_result.gateway.url} target="_blank" rel="noreferrer" style={{color:"#8fc4ff"}}>Abrir aplicação ↗</a></div>}</div><div style={{display:"flex",gap:10,alignItems:"center"}}><span className="pill">{i.status}</span><button className="btn" onClick={()=>void remove(i.id)}>Excluir</button></div></div>)}</section>
    <section className="panel" style={{marginTop:16}}><h2>Fila de execução</h2>{jobs.length===0?<p className="muted">Nenhuma execução registrada.</p>:jobs.map(j=><div className="row" key={j.id}><div><strong>{j.action}</strong><div className="mono">{j.id}</div>{j.error&&<div className="error">{j.error}</div>}</div><span className="pill">{j.status}</span></div>)}</section>
  </main>;
}