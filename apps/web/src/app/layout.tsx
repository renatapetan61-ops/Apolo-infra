import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "APOLO INFRA",
  description: "Painel de controle de infraestruturas APOLO",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // CLERK_PUBLISHABLE_KEY is the canonical server-side variable. Keep the
  // NEXT_PUBLIC_ fallback for deployments that still use the old name.
  const publishableKey =
    process.env.CLERK_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const configured = Boolean(publishableKey && process.env.CLERK_SECRET_KEY);

  return (
    <html lang="pt-BR">
      <body>
        {configured ? (
          <ClerkProvider publishableKey={publishableKey}>{children}</ClerkProvider>
        ) : (
          children
        )}
      </body>
    </html>
  );
}