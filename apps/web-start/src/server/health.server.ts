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
    const publicAPIHealth = publicAPIHealthDTO(api);
    const healthy = response.ok && publicAPIHealth.status === "ok";

    return Response.json(
      {
        service: "campus-gaming-network-web",
        status: healthy ? "ok" : "degraded",
        api: publicAPIHealth
      },
      {
        status: healthy ? 200 : 503,
        headers: { "cache-control": "no-store" }
      }
    );
  } catch {
    return Response.json(
      {
        service: "campus-gaming-network-web",
        status: "degraded",
        reason: "api_unreachable"
      },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }
}

function publicAPIHealthDTO(value: unknown): {
  service?: string;
  status: string;
} {
  if (!value || typeof value !== "object") return { status: "unknown" };
  const record = value as Record<string, unknown>;
  const status = boundedString(record.status, 50) ?? "unknown";
  const service = boundedString(record.service, 100);
  return { ...(service ? { service } : {}), status };
}

function boundedString(value: unknown, maximum: number): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= maximum
    ? value
    : undefined;
}
