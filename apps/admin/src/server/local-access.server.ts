import {
  createSign,
  generateKeyPairSync,
  randomUUID,
  type KeyObject,
} from "node:crypto";
import type { AdminEnvironment } from "./environment.server.js";

const jwksPath = "/cdn-cgi/access/certs";
const assertionLifetimeSeconds = 5 * 60;

type SigningMaterial = {
  keyID: string;
  privateKey: KeyObject;
  publicJWK: JsonWebKey & { kid: string; alg: "RS256"; use: "sig" };
};

let signingMaterial: SigningMaterial | undefined;

/** Publishes only the ephemeral public key used by local development. */
export function localAccessJWKSResponse(
  request: Request,
  environment: AdminEnvironment,
): Response | undefined {
  if (!localAccessEnabled(environment)) return undefined;
  if (new URL(request.url).pathname !== jwksPath) return undefined;

  const headers = {
    allow: "GET, HEAD",
    "cache-control": "private, no-store",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
    "content-type": "application/json",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "x-robots-tag": "noindex, nofollow, noarchive, nosnippet",
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 405, headers });
  }

  const body = JSON.stringify({ keys: [material().publicJWK] });
  return new Response(request.method === "HEAD" ? null : body, {
    status: 200,
    headers,
  });
}

/**
 * Replaces any caller-supplied assertion with a short-lived, signed local one.
 * The normal Admin BFF and Go API validators still verify this assertion.
 */
export function withLocalAccessAssertion(
  request: Request,
  environment: AdminEnvironment,
  now: Date = new Date(),
): Request {
  if (!localAccessEnabled(environment)) return request;

  request.headers.set(
    "Cf-Access-Jwt-Assertion",
    accessAssertion(environment, now),
  );
  return request;
}

function localAccessEnabled(environment: AdminEnvironment): boolean {
  return (
    environment.deploymentEnvironment === "local" &&
    Boolean(
      environment.localAccessEmail &&
      environment.accessIssuer &&
      environment.accessAudience &&
      environment.accessJWKSURL,
    )
  );
}

function accessAssertion(environment: AdminEnvironment, now: Date): string {
  const signing = material();
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const header = segment({ alg: "RS256", typ: "JWT", kid: signing.keyID });
  const claims = segment({
    iss: environment.accessIssuer,
    sub: `local-access-${environment.localAccessEmail}`,
    email: environment.localAccessEmail,
    aud: [environment.accessAudience],
    iat: nowSeconds,
    nbf: nowSeconds,
    exp: nowSeconds + assertionLifetimeSeconds,
  });
  const input = `${header}.${claims}`;
  const signature = createSign("RSA-SHA256")
    .update(input)
    .sign(signing.privateKey)
    .toString("base64url");
  return `${input}.${signature}`;
}

function material(): SigningMaterial {
  if (signingMaterial) return signingMaterial;
  const keyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const keyID = `admin-local-${randomUUID()}`;
  signingMaterial = {
    keyID,
    privateKey: keyPair.privateKey,
    publicJWK: {
      ...keyPair.publicKey.export({ format: "jwk" }),
      kid: keyID,
      alg: "RS256",
      use: "sig",
    },
  };
  return signingMaterial;
}

function segment(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
