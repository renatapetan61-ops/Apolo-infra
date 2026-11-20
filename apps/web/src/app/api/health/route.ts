import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const baseUrl = process.env.APOLO_DATABASE_API_URL?.replace(/\/$/, "");
  const token = process.env.APOLO_DATABASE_API_TOKEN;
  if (!baseUrl || !token) {
    return NextResponse.json(
      { status: "not_ready", service: "apolo-infra-control-plane", database: "not_configured" },
      { status: 503 },
    );
  }
  try {
    const response = await fetch(`${baseUrl}/readyz`, {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      return NextResponse.json(
        { status: "not_ready", service: "apolo-infra-control-plane", database: "unavailable" },
        { status: 503 },
      );
    }
    const readiness = await response.json();
    return NextResponse.json({
      status: "ok",
      service: "apolo-infra-control-plane",
      database: readiness.database,
      timestamp: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json(
      { status: "not_ready", service: "apolo-infra-control-plane", database: "unreachable" },
      { status: 503 },
    );
  }
}
