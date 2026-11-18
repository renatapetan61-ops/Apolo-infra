import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function Home() {
  const { userId } = await auth();
  if (userId) redirect("/dashboard");
  return <main className="shell"><header className="top"><div className="brand">APOLO INFRA</div><span className="muted">Infrastructure Control Plane</span></header><section className="panel" style={{maxWidth:620,margin:"12vh auto"}}><h1>Controle de infraestrutura, em um só lugar.</h1><p className="muted">Entre para gerenciar projetos, acompanhar o Codespace executor e monitorar tarefas Docker, Podman e Nginx.</p><Link className="btn" href="/sign-in">Entrar no painel</Link></section></main>;
}