const localAPIURL = "http://localhost:8080";

type HealthDependencies = {
  apiBaseURL?: string;
  fetcher?: typeof fetch;
};

export function methodNotAllowedResponse(): Response {
  return new Response(null, {
    status: 405,
    headers: { Allow: "GET, HEAD" }
  });
}

export async function apiHealthResponse(
  dependencies: HealthDependencies = {}
): Promise<Response> {
  const apiBaseURL = dependencies.apiBaseURL ?? process.env.API_INTERNAL_URL ?? localAPIURL;
  const fetcher = dependencies.fetcher ?? fetch;

  try {
    const response = await fetcher(`${apiBaseURL}/health`, {
      cache: "no-store"
    });
    const api: unknown = await response.json();

    return Response.json(
      {
        service: "campus-gaming-network-web",
        status: response.ok ? "ok" : "degraded",
        api
      },
      { status: response.ok ? 200 : 503 }
    );
  } catch {
    return Response.json(
      {
        service: "campus-gaming-network-web",
        status: "degraded",
        reason: "api_unreachable"
      },
      { status: 503 }
    );
  }
}
