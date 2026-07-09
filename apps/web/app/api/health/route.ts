import { NextResponse } from "next/server";

const apiBaseUrl = process.env.API_INTERNAL_URL ?? "http://localhost:8080";

export async function GET() {
  try {
    const response = await fetch(`${apiBaseUrl}/health`, {
      cache: "no-store"
    });
    const api = (await response.json()) as unknown;

    return NextResponse.json(
      {
        service: "campus-gaming-network-web",
        status: response.ok ? "ok" : "degraded",
        api
      },
      { status: response.ok ? 200 : 503 }
    );
  } catch {
    return NextResponse.json(
      {
        service: "campus-gaming-network-web",
        status: "degraded",
        reason: "api_unreachable"
      },
      { status: 503 }
    );
  }
}
