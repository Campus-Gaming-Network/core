import {
  AccessAssertionError,
  validateAccessAssertion,
  type AccessIdentity,
} from "./access-assertion.server.js";
import type { AdminEnvironment } from "./environment.server.js";

const healthPath = "/api/health";

// What a refused request carries: no body, and nothing a shared cache or an
// indexer may keep. The security-header middleware never runs for these.
const refusalHeaders = {
  "cache-control": "private, no-store",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "x-robots-tag": "noindex, nofollow, noarchive, nosnippet",
} as const;

/**
 * Refuses, before any route renders, a request that does not carry a valid
 * Cloudflare Access assertion. Cloudflare sends one with every request it lets
 * through, so a request without one came around Access, straight to the
 * origin. Only the platform health check is exempt.
 *
 * A local console with no Access configuration is not gated: it fronts a
 * stand-in API, and the real API refuses the requests it cannot bind.
 */
export async function accessGateResponse(
  request: Request,
  environment: Pick<
    AdminEnvironment,
    | "accessIssuer"
    | "accessAudience"
    | "accessJWKSURL"
    | "deploymentEnvironment"
  >,
  validate: (
    assertion: string,
    config: { issuer?: string; audience?: string; jwksURL?: string },
  ) => Promise<AccessIdentity> = validateAccessAssertion,
): Promise<Response | undefined> {
  const { accessIssuer, accessAudience, accessJWKSURL } = environment;
  if (
    !accessIssuer &&
    !accessAudience &&
    !accessJWKSURL &&
    environment.deploymentEnvironment === "local"
  ) {
    return undefined;
  }
  if (new URL(request.url).pathname === healthPath) return undefined;

  try {
    await validate(request.headers.get("Cf-Access-Jwt-Assertion") ?? "", {
      issuer: accessIssuer,
      audience: accessAudience,
      jwksURL: accessJWKSURL,
    });
    return undefined;
  } catch (error) {
    const unavailable =
      error instanceof AccessAssertionError && error.reason === "unavailable";
    return new Response(null, {
      status: unavailable ? 503 : 403,
      headers: refusalHeaders,
    });
  }
}
