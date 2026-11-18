import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "APOLO INFRA",
  description: "Painel de controle de infraestruturas APOLO",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <ClerkProvider><html lang="pt-BR"><body>{children}</body></html></ClerkProvider>;
}