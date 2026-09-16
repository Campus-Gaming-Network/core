export async function adminHealthResponse(
  dependencies: {
    apiBaseURL?: string;
    fetcher?: typeof fetch;
  } = {}
): Promise<Response> {
  const baseURL =
    dependencies.apiBaseURL ??
    process.env.ADMIN_API_INTERNAL_URL ??
    "http://localhost:8080";
  const fetcher = dependencies.fetcher ?? fetch;
  try {
    const response = await fetcher(`${baseURL.replace(/\/+$/, "")}/health`, {
      cache: "no-store"
    });
    const healthy = response.ok;
    return Response.json(
      {
        service: "campus-gaming-network-admin",
        status: healthy ? "ok" : "degraded"
      },
      {
        status: healthy ? 200 : 503,
        headers: { "cache-control": "private, no-store" }
      }
    );
  } catch {
    return Response.json(
      {
        service: "campus-gaming-network-admin",
        status: "degraded",
        reason: "api_unreachable"
      },
      { status: 503, headers: { "cache-control": "private, no-store" } }
    );
  }
}

export function methodNotAllowedResponse(): Response {
  return new Response(null, {
    status: 405,
    headers: { Allow: "GET, HEAD", "cache-control": "private, no-store" }
  });
}
