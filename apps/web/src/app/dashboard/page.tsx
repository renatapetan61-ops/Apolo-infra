import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Dashboard } from "./ui";

export default async function Page() {
  // Keep the same server-side variable convention used by layout and middleware.
  // Vercel stores CLERK_PUBLISHABLE_KEY (without NEXT_PUBLIC_) to avoid
  // exposing the value through a public environment variable.
  const publishableKey =
    process.env.CLERK_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const configured = Boolean(publishableKey && process.env.CLERK_SECRET_KEY);

  if (!configured) redirect("/");

  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  return <Dashboard />;
}
