import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { headers as incomingHeaders } from "next/headers";
import type * as z from "zod";
import {
  apiRequest,
  type ApiRequestOptions,
  type ApiResult
} from "./cgn-api";

export const visitorIPHeader = "X-CGN-Visitor-IP";
export const proxySecretHeader = "X-CGN-Proxy-Secret";
export const cloudflareSecretHeader = "X-CGN-Cloudflare-Secret";

type HeaderReader = Pick<Headers, "get">;

type BFFRequestDependencies = {
  incomingHeaders?: HeaderReader;
  proxySecret?: string;
  cloudflareOriginSecret?: string;
};

/**
 * Sends a request from the public Next.js BFF to the private Go API.
 *
 * Railway overwrites X-Real-IP at its public boundary. In production,
 * Cloudflare's visitor header wins only when its edge-added marker is also
 * authenticated. Never relay an internal visitor header supplied by the
 * browser. The API secret authenticates the BFF's resulting assertion.
 */
export async function apiRequestFromBFF<TSchema extends z.ZodType>(
  options: ApiRequestOptions<TSchema>,
  dependencies: BFFRequestDependencies = {}
): Promise<ApiResult<z.output<TSchema>>> {
  const requestHeaders =
    dependencies.incomingHeaders ?? (await incomingHeaders());
  const proxySecret =
    dependencies.proxySecret ?? process.env.API_PROXY_SHARED_SECRET ?? "";
  const cloudflareOriginSecret =
    dependencies.cloudflareOriginSecret ??
    process.env.CLOUDFLARE_ORIGIN_SECRET ??
    "";
  const outgoingHeaders = new Headers(options.headers);

  // Caller-provided headers are not allowed to smuggle or retain internal
  // identity. Set both values from the trusted request boundary or neither.
  outgoingHeaders.delete(visitorIPHeader);
  outgoingHeaders.delete(proxySecretHeader);
  outgoingHeaders.delete(cloudflareSecretHeader);

  const visitorIP = visitorIPFromHostingHeaders(
    requestHeaders,
    cloudflareOriginSecret
  );
  if (visitorIP && proxySecret.trim()) {
    outgoingHeaders.set(visitorIPHeader, visitorIP);
    outgoingHeaders.set(proxySecretHeader, proxySecret);
  }

  return apiRequest({
    ...options,
    headers: outgoingHeaders
  });
}

export function visitorIPFromHostingHeaders(
  requestHeaders: HeaderReader,
  cloudflareOriginSecret = ""
): string | null {
  if (
    cloudflareOriginSecret &&
    secretsEqual(
      requestHeaders.get(cloudflareSecretHeader) ?? "",
      cloudflareOriginSecret
    )
  ) {
    const cloudflareVisitorIP = normalizeIPAddress(
      requestHeaders.get("cf-connecting-ip")
    );
    if (cloudflareVisitorIP) {
      return cloudflareVisitorIP;
    }
  }

  return normalizeIPAddress(requestHeaders.get("x-real-ip"));
}

export function normalizeIPAddress(value: string | null): string | null {
  const candidate = value?.trim() ?? "";
  const version = isIP(candidate);

  if (version === 4) {
    return candidate
      .split(".")
      .map((part) => String(Number.parseInt(part, 10)))
      .join(".");
  }
  if (version === 6) {
    // Public forwarding headers must not contain interface-scoped addresses.
    if (candidate.includes("%")) {
      return null;
    }
    // URL canonicalization compresses equivalent IPv6 spellings consistently.
    const hostname = new URL(`http://[${candidate}]/`).hostname;
    return hostname.slice(1, -1);
  }

  return null;
}

function secretsEqual(provided: string, expected: string) {
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);

  return (
    providedBytes.length === expectedBytes.length &&
    timingSafeEqual(providedBytes, expectedBytes)
  );
}
