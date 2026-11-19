import { createClient, type Client, type InValue } from "@libsql/client";

let client: Client | undefined;

function getClient(): Client {
  if (client) return client;
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) throw new Error("TURSO_DATABASE_URL is not configured (persistent SQLite/libSQL database required)");
  client = createClient({ url, authToken });
  return client;
}

// Small tagged-template adapter. SQL is deliberately SQLite syntax; values are always bound.
export async function sql(strings: TemplateStringsArray, ...values: unknown[]) {
  const statement = strings.reduce((query, part, index) => query + part + (index < values.length ? "?" : ""), "");
  const result = await getClient().execute({ sql: statement, args: values as InValue[] });
  return result.rows.map(row => ({ ...row }));
}
