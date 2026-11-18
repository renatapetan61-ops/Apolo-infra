import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function Home() {
  const configured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
  if (!configured) {
    return <main className="shell"><header className="top"><div className="brand">APOLO INFRA</div><span className="muted">Infrastructure Control Plane</span></header><section className="panel" style={{maxWidth:680,margin:"12vh auto"}}><h1>Painel APOLO INFRA publicado.</h1><p className="muted">O deploy está ativo. Para liberar o login e o gerenciamento, configure Clerk e Neon Postgres nas variáveis de ambiente da Vercel e execute o schema SQL do repositório.</p><p><a href="/api/health" className="btn">Verificar API</a></p></section></main>;
  }
  const { userId } = await auth();
  if (userId) redirect("/dashboard");
  return <main className="shell"><header className="top"><div className="brand">APOLO INFRA</div><span className="muted">Infrastructure Control Plane</span></header><section className="panel" style={{maxWidth:620,margin:"12vh auto"}}><h1>Controle de infraestrutura, em um só lugar.</h1><p className="muted">Entre para gerenciar projetos, acompanhar o Codespace executor e monitorar tarefas Docker, Podman e Nginx.</p><Link className="btn" href="/sign-in">Entrar no painel</Link></section></main>;
}