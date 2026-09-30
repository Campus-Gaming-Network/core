import assert from "node:assert/strict";
import test from "node:test";
import { AccessAssertionError } from "../src/server/access-assertion.server.js";
import { accessGateResponse } from "../src/server/access-gate.server.js";

const configured = {
  deploymentEnvironment: "staging" as const,
  accessIssuer: "https://cgn.cloudflareaccess.com",
  accessAudience: "admin-audience",
  accessJWKSURL: "https://cgn.cloudflareaccess.com/cdn-cgi/access/certs",
};
const identity = { email: "admin@example.test", subject: "access-subject" };

function request(path: string, assertion?: string) {
  return new Request(`https://admin.example.test${path}`, {
    headers:
      assertion === undefined ? {} : { "Cf-Access-Jwt-Assertion": assertion },
  });
}

test("a request with a valid assertion reaches the console", async () => {
  const seen: string[] = [];
  const refusal = await accessGateResponse(
    request("/reports", "signed"),
    configured,
    async (assertion, config) => {
      seen.push(assertion, config.audience ?? "");
      return identity;
    },
  );

  assert.equal(refusal, undefined);
  assert.deepEqual(seen, ["signed", "admin-audience"]);
});

test("a request that came around Access is refused before anything renders", async () => {
  const cases: {
    name: string;
    reason: "missing" | "invalid" | "unavailable";
    status: number;
  }[] = [
    { name: "no assertion", reason: "missing", status: 403 },
    { name: "a forged assertion", reason: "invalid", status: 403 },
    { name: "keys that cannot be fetched", reason: "unavailable", status: 503 },
  ];

  await Promise.all(
    cases.map(async ({ name, reason, status }) => {
      const refusal = await accessGateResponse(
        request("/reports", reason === "missing" ? undefined : "forged"),
        configured,
        async () => {
          throw new AccessAssertionError(reason);
        },
      );

      assert.ok(refusal, name);
      assert.equal(refusal.status, status, name);
      assert.equal(await refusal.text(), "", `${name} has no body`);
      assert.equal(refusal.headers.get("cache-control"), "private, no-store");
      assert.match(refusal.headers.get("x-robots-tag") ?? "", /noindex/);
      assert.equal(refusal.headers.get("x-frame-options"), "DENY");
    }),
  );
});

test("any unexpected verification failure refuses the request", async () => {
  const refusal = await accessGateResponse(
    request("/reports", "signed"),
    configured,
    async () => {
      throw new Error("unexpected");
    },
  );

  assert.equal(refusal?.status, 403);
});

const neverCalled = async (): Promise<never> => {
  throw new Error("the health check must not need an assertion");
};

test("only the platform health check is exempt", async () => {
  assert.equal(
    await accessGateResponse(request("/api/health"), configured, neverCalled),
    undefined,
  );
  const lookalikes = await Promise.all(
    ["/api/health/", "/api/healthz", "//api/health", "/x/api/health"].map(
      (path) => accessGateResponse(request(path), configured, neverCalled),
    ),
  );
  assert.deepEqual(
    lookalikes.map((response) => response?.status),
    [403, 403, 403, 403],
  );
});

test("a local console with no Access configuration is not gated, but a partial one is", async () => {
  const local = { deploymentEnvironment: "local" as const };
  assert.equal(await accessGateResponse(request("/reports"), local), undefined);

  const refusal = await accessGateResponse(
    request("/reports"),
    { ...local, accessIssuer: configured.accessIssuer },
    async () => {
      throw new AccessAssertionError("unavailable");
    },
  );
  assert.equal(refusal?.status, 503);
});
