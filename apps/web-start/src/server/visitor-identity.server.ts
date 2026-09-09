import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

export const visitorIPHeader = "X-CGN-Visitor-IP";
export const proxySecretHeader = "X-CGN-Proxy-Secret";
export const cloudflareSecretHeader = "X-CGN-Cloudflare-Secret";

type HeaderReader = Pick<Headers, "get">;

type TrustedVisitorHeadersOptions = {
  incomingHeaders: HeaderReader;
  outgoingHeaders?: HeadersInit;
  proxySecret: string;
  cloudflareOriginSecret?: string;
};

export function headersWithTrustedVisitorIdentity({
  incomingHeaders,
  outgoingHeaders,
  proxySecret,
  cloudflareOriginSecret = ""
}: TrustedVisitorHeadersOptions): Headers {
  const headers = sanitizeInternalHeaders(outgoingHeaders);
  const visitorIP = visitorIPFromHostingHeaders(
    incomingHeaders,
    cloudflareOriginSecret
  );

  if (visitorIP && proxySecret.trim()) {
    headers.set(visitorIPHeader, visitorIP);
    headers.set(proxySecretHeader, proxySecret);
  }

  return headers;
}

export function sanitizeInternalHeaders(headers?: HeadersInit): Headers {
  const sanitized = new Headers(headers);

  sanitized.delete(visitorIPHeader);
  sanitized.delete(proxySecretHeader);
  sanitized.delete(cloudflareSecretHeader);

  return sanitized;
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
    if (candidate.includes("%")) {
      return null;
    }

    const hostname = new URL(`http://[${candidate}]/`).hostname;
    return hostname.slice(1, -1);
  }

  return null;
}

function secretsEqual(provided: string, expected: string): boolean {
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);

  return (
    providedBytes.length === expectedBytes.length &&
    timingSafeEqual(providedBytes, expectedBytes)
  );
}
