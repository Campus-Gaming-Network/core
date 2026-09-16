import * as z from "zod";

const headerSchema = z.object({
  alg: z.literal("RS256"),
  kid: z.string().min(1).max(512)
});

const claimsSchema = z.object({
  iss: z.string().min(1),
  sub: z.string().min(1),
  email: z.email(),
  aud: z.union([z.string(), z.array(z.string())]),
  exp: z.number().int(),
  iat: z.number().int(),
  nbf: z.number().int().optional()
});

const jwksSchema = z.object({
  keys: z.array(
    z.object({
      kty: z.literal("RSA"),
      kid: z.string(),
      alg: z.literal("RS256").optional(),
      use: z.literal("sig").optional(),
      n: z.string(),
      e: z.string()
    })
  )
});

export type AccessAssertionConfig = {
  issuer?: string;
  audience?: string;
  jwksURL?: string;
};

export class AccessAssertionError extends Error {
  readonly reason: "missing" | "invalid" | "unavailable";

  constructor(reason: "missing" | "invalid" | "unavailable") {
    super(`Cloudflare Access assertion ${reason}`);
    this.name = "AccessAssertionError";
    this.reason = reason;
  }
}

type KeyCache = { expiresAt: number; keys: Map<string, JsonWebKey> };
let keyCache: KeyCache | undefined;

export async function validateAccessAssertion(
  assertion: string,
  config: AccessAssertionConfig,
  dependencies: {
    fetcher?: typeof fetch;
    now?: () => Date;
    cacheTTLMilliseconds?: number;
  } = {}
): Promise<void> {
  if (!assertion.trim()) throw new AccessAssertionError("missing");
  if (assertion.length > 64 * 1024) throw new AccessAssertionError("invalid");
  if (!config.issuer || !config.audience || !config.jwksURL) {
    throw new AccessAssertionError("unavailable");
  }

  const parts = assertion.split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) {
    throw new AccessAssertionError("invalid");
  }

  const header = parseSegment(parts[0], headerSchema);
  const claims = parseSegment(parts[1], claimsSchema);
  if (!header || !claims) throw new AccessAssertionError("invalid");

  const now = dependencies.now?.() ?? new Date();
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const skewSeconds = 30;
  const issuer = config.issuer.replace(/\/+$/, "");
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (
    claims.iss.replace(/\/+$/, "") !== issuer ||
    !audiences.includes(config.audience) ||
    claims.exp <= nowSeconds - skewSeconds ||
    claims.iat > nowSeconds + skewSeconds ||
    claims.exp <= claims.iat ||
    (claims.nbf !== undefined && claims.nbf > nowSeconds + skewSeconds)
  ) {
    throw new AccessAssertionError("invalid");
  }

  const key = await signingKey(header.kid, config.jwksURL, {
    fetcher: dependencies.fetcher,
    now,
    cacheTTLMilliseconds: dependencies.cacheTTLMilliseconds
  });
  let signature: ArrayBuffer;
  try {
    const bytes = Buffer.from(parts[2], "base64url");
    signature = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer;
  } catch {
    throw new AccessAssertionError("invalid");
  }

  try {
    const imported = await crypto.subtle.importKey(
      "jwk",
      key,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const verified = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      imported,
      signature,
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    );
    if (!verified) throw new AccessAssertionError("invalid");
  } catch (error) {
    if (error instanceof AccessAssertionError) throw error;
    throw new AccessAssertionError("invalid");
  }
}

async function signingKey(
  keyID: string,
  jwksURL: string,
  dependencies: {
    fetcher?: typeof fetch;
    now: Date;
    cacheTTLMilliseconds?: number;
  }
): Promise<JsonWebKey> {
  if (keyCache && keyCache.expiresAt > dependencies.now.getTime()) {
    const cached = keyCache.keys.get(keyID);
    if (cached) return cached;
  }

  const fetcher = dependencies.fetcher ?? fetch;
  let response: Response;
  try {
    response = await fetcher(jwksURL, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(5000)
    });
  } catch {
    throw new AccessAssertionError("unavailable");
  }
  if (!response.ok) throw new AccessAssertionError("unavailable");
  const text = await response.text();
  if (text.length > 1024 * 1024) throw new AccessAssertionError("unavailable");
  let payload: unknown;
  try {
    payload = JSON.parse(text) as unknown;
  } catch {
    throw new AccessAssertionError("unavailable");
  }
  const parsed = jwksSchema.safeParse(payload);
  if (!parsed.success) throw new AccessAssertionError("unavailable");
  const keys = new Map<string, JsonWebKey>();
  for (const key of parsed.data.keys) {
    if ((key.alg === undefined || key.alg === "RS256") &&
      (key.use === undefined || key.use === "sig")) {
      keys.set(key.kid, key);
    }
  }
  keyCache = {
    expiresAt:
      dependencies.now.getTime() +
      (dependencies.cacheTTLMilliseconds ?? 5 * 60 * 1000),
    keys
  };
  const key = keys.get(keyID);
  if (!key) throw new AccessAssertionError("invalid");
  return key;
}

function parseSegment<T extends z.ZodType>(
  segment: string,
  schema: T
): z.output<T> | null {
  try {
    const payload: unknown = JSON.parse(
      Buffer.from(segment, "base64url").toString("utf8")
    );
    const parsed = schema.safeParse(payload);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
