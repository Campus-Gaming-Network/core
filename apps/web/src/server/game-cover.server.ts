const localAPIURL = "http://localhost:8080";

type GameCoverDependencies = {
  apiBaseURL?: string;
  fetcher?: typeof fetch;
};

// Game slugs are lowercase letters, digits, and single hyphens.
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Serves a game's stored cover from this origin. The Go API holds the bytes;
 * the browser never contacts the API or IGDB. No cookie or identity is
 * forwarded, because covers are public.
 */
export async function gameCoverResponse(
  request: Request,
  slug: string,
  dependencies: GameCoverDependencies = {},
): Promise<Response> {
  if (slug.length > 120 || !slugPattern.test(slug)) {
    return new Response(null, { status: 404 });
  }
  const apiBaseURL =
    dependencies.apiBaseURL ?? process.env.API_INTERNAL_URL ?? localAPIURL;
  const fetcher = dependencies.fetcher ?? fetch;
  const known = request.headers.get("if-none-match");

  let upstream: Response;
  try {
    upstream = await fetcher(`${apiBaseURL}/games/${slug}/cover`, {
      headers: known ? { "if-none-match": known } : {},
    });
  } catch {
    return new Response(null, { status: 502 });
  }
  if (upstream.status !== 200 && upstream.status !== 304) {
    return new Response(null, {
      status: upstream.status === 404 ? 404 : 502,
    });
  }

  const headers = new Headers({
    "cache-control": "public, max-age=86400",
    "x-content-type-options": "nosniff",
    // Opened directly, a cover can run no script and load nothing.
    "content-security-policy": "default-src 'none'; sandbox",
  });
  for (const name of ["content-type", "etag"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(upstream.status === 200 ? upstream.body : null, {
    status: upstream.status,
    headers,
  });
}
