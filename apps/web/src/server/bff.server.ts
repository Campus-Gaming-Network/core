import {
  createApiClient,
  type ApiClient,
  type Fetcher
} from "./api.server.js";
import { headersWithTrustedVisitorIdentity } from "./visitor-identity.server.js";

type HeaderReader = Pick<Headers, "get">;

export type GoBFFClientDependencies = {
  incomingHeaders: HeaderReader;
  proxySecret?: string;
  cloudflareOriginSecret?: string;
  trustRailwayHeaders?: boolean;
  baseUrl?: string;
  fetcher?: Fetcher;
};

/**
 * Adapts the framework-neutral HTTP client to the Go API trust boundary.
 * Browser-provided internal identity headers are always discarded before the
 * BFF derives and authenticates a replacement from hosting headers.
 */
export function createGoBFFClient({
  incomingHeaders,
  proxySecret = process.env.API_PROXY_SHARED_SECRET ?? "",
  cloudflareOriginSecret = process.env.CLOUDFLARE_ORIGIN_SECRET ?? "",
  trustRailwayHeaders = Boolean(process.env.RAILWAY_ENVIRONMENT_ID),
  baseUrl = process.env.API_INTERNAL_URL ?? "http://localhost:8080",
  fetcher = fetch
}: GoBFFClientDependencies): ApiClient {
  return createApiClient({
    baseUrl,
    fetcher,
    prepareHeaders: (headers) =>
      headersWithTrustedVisitorIdentity({
        incomingHeaders,
        outgoingHeaders: headers,
        proxySecret,
        cloudflareOriginSecret,
        trustRailwayHeaders
      })
  });
}
