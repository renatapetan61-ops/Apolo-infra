import { SignUp } from "@clerk/nextjs";
export default function Page() {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || !process.env.CLERK_SECRET_KEY) return <main className="shell"><section className="panel"><h1>Cadastro ainda não configurado</h1><p className="muted">Configure as chaves do Clerk no projeto Vercel para habilitar o cadastro.</p></section></main>;
  return <main className="shell" style={{display:"grid",placeItems:"center",minHeight:"100vh"}}><SignUp /></main>;
}