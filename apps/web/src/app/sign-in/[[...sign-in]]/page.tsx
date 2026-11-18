import { SignIn } from "@clerk/nextjs";
export default function Page() {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || !process.env.CLERK_SECRET_KEY) return <main className="shell"><section className="panel"><h1>Login ainda não configurado</h1><p className="muted">Configure as chaves do Clerk no projeto Vercel para habilitar a autenticação.</p></section></main>;
  return <main className="shell" style={{display:"grid",placeItems:"center",minHeight:"100vh"}}><SignIn /></main>;
}