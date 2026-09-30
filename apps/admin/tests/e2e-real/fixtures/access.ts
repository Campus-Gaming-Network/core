import { createHmac, createSign, generateKeyPairSync } from "node:crypto";
import type { BrowserContext } from "@playwright/test";

export const accessIssuer = "http://127.0.0.1:18085";
export const accessAudience = "admin-real-e2e-audience";

function segment(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/**
 * Signs a Cloudflare Access assertion with the run's key. `issuedSecondsAgo`
 * places the identity confirmation in the past so a later assertion is
 * provably fresher than the session it rotates.
 */
export function accessAssertion(
  email: string,
  { issuedSecondsAgo = 0, keyID = process.env.ADMIN_REAL_E2E_KEY_ID } = {},
): string {
  const now = Math.floor(Date.now() / 1000);
  const header = segment({ alg: "RS256", typ: "JWT", kid: keyID });
  const claims = segment({
    iss: accessIssuer,
    sub: `access-${email}`,
    email,
    aud: [accessAudience],
    iat: now - issuedSecondsAgo,
    nbf: now - issuedSecondsAgo,
    exp: now + 3600,
  });
  const signature = createSign("RSA-SHA256")
    .update(`${header}.${claims}`)
    .sign(process.env.ADMIN_REAL_E2E_PRIVATE_KEY ?? "");
  return `${header}.${claims}.${signature.toString("base64url")}`;
}

/** Sends the assertion on every request, as Cloudflare Access does. */
export async function signInThroughAccess(
  context: BrowserContext,
  email: string,
  options?: Parameters<typeof accessAssertion>[1],
) {
  await context.setExtraHTTPHeaders({
    "Cf-Access-Jwt-Assertion": accessAssertion(email, options),
  });
}

type ForgedAssertion = {
  email: string;
  alg?: "RS256" | "none" | "HS256";
  keyID?: string;
  issuer?: string;
  audience?: string;
  /** Seconds from now; negative is already expired. */
  expiresIn?: number;
  /** Seconds from now until the assertion becomes valid. */
  notBefore?: number;
  /** Sign with this key instead of the run's; `attacker` generates a new one. */
  signWith?: "run" | "attacker";
};

const attackerKey = generateKeyPairSync("rsa", { modulusLength: 2048 });

/**
 * Builds an assertion that differs from a genuine one in exactly one way, so
 * each rejection can be attributed to the check that caused it.
 */
export function forgeAssertion({
  email,
  alg = "RS256",
  keyID = process.env.ADMIN_REAL_E2E_KEY_ID,
  issuer = accessIssuer,
  audience = accessAudience,
  expiresIn = 3600,
  notBefore = 0,
  signWith = "run",
}: ForgedAssertion): string {
  const now = Math.floor(Date.now() / 1000);
  const header = segment({ alg, typ: "JWT", kid: keyID });
  const claims = segment({
    iss: issuer,
    sub: `access-${email}`,
    email,
    aud: [audience],
    iat: now - 60,
    nbf: now + notBefore,
    exp: now + expiresIn,
  });
  const signingInput = `${header}.${claims}`;
  if (alg === "none") return `${signingInput}.`;
  if (alg === "HS256") {
    // Algorithm confusion: sign with the published public key as the secret.
    const publicKey = JSON.parse(process.env.ADMIN_REAL_E2E_PUBLIC_JWK ?? "{}");
    return `${signingInput}.${createHmac("sha256", publicKey.n ?? "")
      .update(signingInput)
      .digest("base64url")}`;
  }
  const key =
    signWith === "attacker"
      ? attackerKey.privateKey
      : (process.env.ADMIN_REAL_E2E_PRIVATE_KEY ?? "");
  return `${signingInput}.${createSign("RSA-SHA256").update(signingInput).sign(key).toString("base64url")}`;
}
