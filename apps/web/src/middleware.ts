import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const publishableKey =
  process.env.CLERK_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
const clerkConfigured = Boolean(publishableKey && process.env.CLERK_SECRET_KEY);

// Preview deployments without Clerk keys remain viewable for visual review.
// Protected pages and APIs still require Clerk; the dashboard preview is read-only.
const middleware = clerkConfigured
  ? clerkMiddleware({ publishableKey })
  : () => NextResponse.next();

export default middleware;

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
