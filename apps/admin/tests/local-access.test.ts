import assert from "node:assert/strict";
import test from "node:test";
import { validateAccessAssertion } from "../src/server/access-assertion.server.js";
import type { AdminEnvironment } from "../src/server/environment.server.js";
import {
  localAccessJWKSResponse,
  withLocalAccessAssertion,
} from "../src/server/local-access.server.js";

const environment: AdminEnvironment = {
  deploymentEnvironment: "local",
  apiInternalURL: "http://api:8080",
  apiProxySecret: "local-admin-bff-proxy-secret-000000",
  siteOrigin: "http://localhost:3002",
  sessionCookieName: "cgn_admin_session",
  csrfCookieName: "cgn_admin_csrf",
  accessIssuer: "http://admin:3002",
  accessAudience: "cgn-local-admin",
  accessJWKSURL: "http://admin:3002/cdn-cgi/access/certs",
  localAccessEmail: "dev@campusgamingnetwork.test",
};

test("local access replaces an untrusted assertion with a verifiable identity", async () => {
  const now = new Date("2026-10-03T12:00:00Z");
  const request = withLocalAccessAssertion(
    new Request("http://localhost:3002/reports", {
      headers: { "Cf-Access-Jwt-Assertion": "caller-controlled" },
    }),
    environment,
    now,
  );
  const assertion = request.headers.get("Cf-Access-Jwt-Assertion") ?? "";
  assert.notEqual(assertion, "caller-controlled");

  const identity = await validateAccessAssertion(
    assertion,
    {
      issuer: environment.accessIssuer,
      audience: environment.accessAudience,
      jwksURL: environment.accessJWKSURL,
    },
    {
      now: () => now,
      fetcher: async (input) => {
        const response = localAccessJWKSResponse(
          new Request(input),
          environment,
        );
        assert.ok(response);
        return response;
      },
    },
  );

  assert.deepEqual(identity, {
    email: "dev@campusgamingnetwork.test",
    subject: "local-access-dev@campusgamingnetwork.test",
  });
});

test("the local JWKS endpoint exposes only the ephemeral public key", async () => {
  const response = localAccessJWKSResponse(
    new Request(environment.accessJWKSURL ?? ""),
    environment,
  );
  assert.ok(response);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const body = (await response.json()) as { keys: Record<string, unknown>[] };
  assert.equal(body.keys.length, 1);
  assert.equal(body.keys[0]?.kty, "RSA");
  assert.equal(body.keys[0]?.alg, "RS256");
  assert.equal("d" in (body.keys[0] ?? {}), false);

  const refused = localAccessJWKSResponse(
    new Request(environment.accessJWKSURL ?? "", { method: "POST" }),
    environment,
  );
  assert.equal(refused?.status, 405);
});

test("local access remains inactive without an explicit local identity", () => {
  const disabled = { ...environment, localAccessEmail: undefined };
  const request = new Request("http://localhost:3002/reports", {
    headers: { "Cf-Access-Jwt-Assertion": "original" },
  });
  assert.equal(withLocalAccessAssertion(request, disabled), request);
  assert.equal(
    localAccessJWKSResponse(
      new Request(environment.accessJWKSURL ?? ""),
      disabled,
    ),
    undefined,
  );
});

test("local access never activates for a strict deployment", () => {
  const production = {
    ...environment,
    deploymentEnvironment: "production" as const,
  };
  const request = new Request("https://admin.example.test/reports");
  assert.equal(withLocalAccessAssertion(request, production), request);
});
