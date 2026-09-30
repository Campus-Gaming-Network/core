import { createSign } from "node:crypto";
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
