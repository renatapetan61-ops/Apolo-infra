import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Dashboard } from "./ui";
export default async function Page() {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || !process.env.CLERK_SECRET_KEY) redirect("/");
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  return <Dashboard />;
}