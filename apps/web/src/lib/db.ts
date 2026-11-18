import { neon } from "@neondatabase/serverless";

// Resolve DATABASE_URL at request time so Next.js can collect route metadata at build time.
export const sql = (strings: TemplateStringsArray, ...values: any[]) => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not configured");
  return neon(url)(strings, ...values);
};
