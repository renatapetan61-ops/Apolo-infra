type SqlValue = string | number | boolean | null;

export async function sql(strings: TemplateStringsArray, ...values: unknown[]) {
  const statement = strings.reduce(
    (query, part, index) => query + part + (index < values.length ? "?" : ""),
    "",
  );
  const baseUrl = process.env.APOLO_DATABASE_API_URL?.replace(/\/$/, "");
  const token = process.env.APOLO_DATABASE_API_TOKEN;
  if (!baseUrl || !token) {
    throw new Error("APOLO_DATABASE_API_URL and APOLO_DATABASE_API_TOKEN must be configured");
  }

  const response = await fetch(`${baseUrl}/internal/sql`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "cache-control": "no-store",
    },
    body: JSON.stringify({ statement, args: values as SqlValue[] }),
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`APOLO SQLite API returned HTTP ${response.status}: ${detail.slice(0, 500)}`);
  }
  const payload = await response.json() as { rows?: Record<string, unknown>[] };
  if (!Array.isArray(payload.rows)) throw new Error("APOLO SQLite API returned an invalid response");
  return payload.rows;
}
