import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "APOLO INFRA",
  description: "Painel de controle de infraestruturas APOLO",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const configured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
  return <html lang="pt-BR"><body>{configured ? <ClerkProvider>{children}</ClerkProvider> : children}</body></html>;
}