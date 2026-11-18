import { SignIn } from "@clerk/nextjs";

export default function Page() {
  const configured = Boolean(
    (process.env.CLERK_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) &&
      process.env.CLERK_SECRET_KEY,
  );

  if (!configured) return <main className="shell"><section className="panel"><h1>Login ainda não configurado</h1><p className="muted">Configure CLERK_PUBLISHABLE_KEY e CLERK_SECRET_KEY no projeto Vercel para habilitar a autenticação.</p></section></main>;
  return <main className="shell" style={{display:"grid",placeItems:"center",minHeight:"100vh"}}><SignIn /></main>;
}