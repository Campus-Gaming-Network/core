import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSafeEnvironment,
  environmentValidationIssues
} from "../lib/environment.js";

test("allows deliberate local defaults without provider credentials", () => {
  assert.deepEqual(environmentValidationIssues({}), []);
  assert.doesNotThrow(() => assertSafeEnvironment({ DEPLOYMENT_ENV: "local" }));
});

test("rejects invalid values that are explicitly configured locally", () => {
  assert.deepEqual(
    environmentValidationIssues({
      DEPLOYMENT_ENV: "local",
      API_INTERNAL_URL: "not-a-url",
      API_SESSION_COOKIE: "bad cookie",
      NEXT_PUBLIC_SITE_URL: "https://example.com/path"
    }),
    [
      "API_INTERNAL_URL must be an absolute HTTP(S) origin",
      "NEXT_PUBLIC_SITE_URL must be an absolute HTTP(S) origin",
      "API_SESSION_COOKIE must be a valid cookie name"
    ]
  );
});

test("rejects a whitespace-only deployment environment", () => {
  assert.deepEqual(environmentValidationIssues({ DEPLOYMENT_ENV: "  " }), [
    "DEPLOYMENT_ENV must be local, staging, or production"
  ]);
});

for (const deploymentEnvironment of ["staging", "production"] as const) {
  test(`accepts a valid ${deploymentEnvironment} environment`, () => {
    assert.deepEqual(
      environmentValidationIssues(
        validStrictEnvironment(deploymentEnvironment)
      ),
      []
    );
  });
}

test("rejects every missing strict-mode setting", () => {
  assert.deepEqual(environmentValidationIssues({ DEPLOYMENT_ENV: "production" }), [
    "API_INTERNAL_URL must be set",
    "NEXT_PUBLIC_SITE_URL must be set",
    "API_SESSION_COOKIE must be set",
    "API_PROXY_SHARED_SECRET must contain at least 32 characters",
    "CLOUDFLARE_ORIGIN_SECRET must contain at least 32 characters"
  ]);
});

const unsafeProductionSettings: Array<{
  name: string;
  values: Record<string, string>;
  expected: RegExp;
}> = [
  {
    name: "unknown deployment environment",
    values: { DEPLOYMENT_ENV: "preview" },
    expected: /DEPLOYMENT_ENV/
  },
  {
    name: "malformed internal URL",
    values: { API_INTERNAL_URL: "not-an-origin" },
    expected: /API_INTERNAL_URL must be an absolute HTTP\(S\) origin/
  },
  {
    name: "internal URL with credentials",
    values: { API_INTERNAL_URL: "http://user:password@api.internal:8080" },
    expected: /API_INTERNAL_URL must be an absolute HTTP\(S\) origin/
  },
  {
    name: "local internal URL",
    values: { API_INTERNAL_URL: "http://127.0.0.1:8080" },
    expected: /API_INTERNAL_URL must not use a local hostname/
  },
  {
    name: "malformed public site URL",
    values: { NEXT_PUBLIC_SITE_URL: "campusgamingnetwork.com" },
    expected: /NEXT_PUBLIC_SITE_URL must be an absolute HTTP\(S\) origin/
  },
  {
    name: "public site URL with path",
    values: { NEXT_PUBLIC_SITE_URL: "https://campusgamingnetwork.com/app" },
    expected: /NEXT_PUBLIC_SITE_URL must be an absolute HTTP\(S\) origin/
  },
  {
    name: "insecure public site URL",
    values: { NEXT_PUBLIC_SITE_URL: "http://campusgamingnetwork.com" },
    expected: /NEXT_PUBLIC_SITE_URL must use HTTPS/
  },
  {
    name: "local public site URL",
    values: { NEXT_PUBLIC_SITE_URL: "https://localhost:3000" },
    expected: /NEXT_PUBLIC_SITE_URL must not use a local hostname/
  },
  {
    name: "invalid session cookie name",
    values: { API_SESSION_COOKIE: "bad cookie" },
    expected: /API_SESSION_COOKIE must be a valid cookie name/
  },
  {
    name: "short BFF proxy secret",
    values: { API_PROXY_SHARED_SECRET: "short" },
    expected: /API_PROXY_SHARED_SECRET must contain at least 32 characters/
  },
  {
    name: "whitespace-padded BFF proxy secret",
    values: { API_PROXY_SHARED_SECRET: "                short                " },
    expected: /API_PROXY_SHARED_SECRET must contain at least 32 characters/
  },
  {
    name: "short Cloudflare origin secret",
    values: { CLOUDFLARE_ORIGIN_SECRET: "short" },
    expected: /CLOUDFLARE_ORIGIN_SECRET must contain at least 32 characters/
  }
];

for (const { name, values, expected } of unsafeProductionSettings) {
  test(`rejects production ${name}`, () => {
    const environment = { ...validStrictEnvironment("production"), ...values };
    assert.throws(() => assertSafeEnvironment(environment), expected);
  });
}

test("does not expose configured secrets in validation errors", () => {
  const proxySecret = "do-not-log-proxy-secret";
  const originSecret = "do-not-log-origin-secret";
  const environment = {
    ...validStrictEnvironment("production"),
    API_PROXY_SHARED_SECRET: proxySecret,
    CLOUDFLARE_ORIGIN_SECRET: originSecret
  };

  assert.throws(
    () => assertSafeEnvironment(environment),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, new RegExp(proxySecret));
      assert.doesNotMatch(error.message, new RegExp(originSecret));
      return true;
    }
  );
});

function validStrictEnvironment(
  deploymentEnvironment: "staging" | "production"
): Record<string, string> {
  return {
    DEPLOYMENT_ENV: deploymentEnvironment,
    API_INTERNAL_URL: "http://api.railway.internal:8080",
    API_SESSION_COOKIE: "cgn_session",
    API_PROXY_SHARED_SECRET: "01234567890123456789012345678901",
    CLOUDFLARE_ORIGIN_SECRET: "abcdefghijklmnopqrstuvwxyzABCDEF",
    NEXT_PUBLIC_SITE_URL: "https://campusgamingnetwork.com"
  };
}
