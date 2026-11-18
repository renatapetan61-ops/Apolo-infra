import { clerkMiddleware } from "@clerk/nextjs/server";

// Pass the publishable key at request time so Clerk's server helpers (auth())
// receive the same key while Vercel keeps the variable name server-side.
export default clerkMiddleware({
  publishableKey:
    process.env.CLERK_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
