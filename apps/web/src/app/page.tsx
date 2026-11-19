import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Dashboard } from "./dashboard/ui";

export default async function Home() {
  const publishableKey =
    process.env.CLERK_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const configured = Boolean(publishableKey && process.env.CLERK_SECRET_KEY);

  // A Preview deployment may not have Clerk Preview keys. Render a read-only
  // dashboard preview instead of failing in middleware or exposing API data.
  if (!configured) return <Dashboard previewMode />;

  const { userId } = await auth();
  if (userId) redirect("/dashboard");
  redirect("/sign-in");
}
