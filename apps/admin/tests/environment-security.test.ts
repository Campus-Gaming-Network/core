import assert from "node:assert/strict";
import test from "node:test";
import {
  adminEnvironment,
  environmentValidationIssues,
} from "../src/server/environment.server.js";

const safeProduction = {
  DEPLOYMENT_ENV: "production",
  ADMIN_API_INTERNAL_URL: "http://api.railway.internal:8080",
  ADMIN_SITE_URL: "https://admin.campusgamingnetwork.com",
  ADMIN_API_PROXY_SHARED_SECRET: "a".repeat(48),
  API_PROXY_SHARED_SECRET: "b".repeat(48),
  ADMIN_SESSION_COOKIE: "__Host-cgn_admin_session",
  ADMIN_CSRF_COOKIE: "__Host-cgn_admin_csrf",
  CLOUDFLARE_ACCESS_TEAM_DOMAIN: "https://cgn.cloudflareaccess.com",
  CLOUDFLARE_ACCESS_AUDIENCE: "admin-audience",
  CLOUDFLARE_ACCESS_JWKS_URL:
    "https://cgn.cloudflareaccess.com/cdn-cgi/access/certs",
  R2_PUBLIC_ASSET_ORIGIN: "https://assets.campusgamingnetwork.com",
};

test("accepts a separate production Admin Console boundary", () => {
  assert.deepEqual(environmentValidationIssues(safeProduction), []);
  const environment = adminEnvironment(safeProduction);
  assert.equal(environment.sessionCookieName, "__Host-cgn_admin_session");
  assert.equal(environment.siteOrigin, "https://admin.campusgamingnetwork.com");
});

test("rejects public credentials, insecure origins, and non-Host cookies", () => {
  const issues = environmentValidationIssues({
    ...safeProduction,
    ADMIN_API_INTERNAL_URL: "http://localhost:8080",
    ADMIN_SITE_URL: "http://admin.example.test",
    ADMIN_API_PROXY_SHARED_SECRET: safeProduction.API_PROXY_SHARED_SECRET,
    ADMIN_SESSION_COOKIE: "cgn_admin_session",
    ADMIN_CSRF_COOKIE: "cgn_admin_csrf",
  });

  assert.ok(issues.some((issue) => issue.includes("must differ")));
  assert.ok(issues.some((issue) => issue.includes("must use HTTPS")));
  assert.ok(issues.some((issue) => issue.includes("local hostname")));
  assert.ok(issues.some((issue) => issue.includes("__Host-cgn_admin_session")));
  assert.ok(issues.some((issue) => issue.includes("__Host-cgn_admin_csrf")));
});

test("validation messages never contain credential values", () => {
  const canary = "super-secret-canary-value";
  const issues = environmentValidationIssues({
    ...safeProduction,
    ADMIN_API_PROXY_SHARED_SECRET: canary,
  });
  assert.ok(issues.length > 0);
  assert.equal(issues.join(" ").includes(canary), false);
});

test("logo previews load only from an HTTPS asset origin outside local", () => {
  assert.deepEqual(
    [
      { R2_PUBLIC_ASSET_ORIGIN: "" },
      { R2_PUBLIC_ASSET_ORIGIN: "http://assets.campusgamingnetwork.com" },
      {
        R2_PUBLIC_ASSET_ORIGIN: "https://assets.campusgamingnetwork.com/logos",
      },
    ].map((override) =>
      environmentValidationIssues({ ...safeProduction, ...override }),
    ),
    [
      ["R2_PUBLIC_ASSET_ORIGIN must be set"],
      ["R2_PUBLIC_ASSET_ORIGIN must be an HTTPS origin"],
      ["R2_PUBLIC_ASSET_ORIGIN must be an HTTPS origin"],
    ],
  );
  // Locally the base may carry the storage bucket's path.
  assert.equal(
    adminEnvironment({
      R2_PUBLIC_ASSET_ORIGIN: "http://localhost:9090/cgn-school-logos",
    }).logoAssetBase,
    "http://localhost:9090/cgn-school-logos",
  );
});

test("the public site link is optional and HTTPS outside local", () => {
  assert.deepEqual(
    ["http://campusgamingnetwork.com", "not a url"].map((value) =>
      environmentValidationIssues({
        ...safeProduction,
        PUBLIC_SITE_URL: value,
      }),
    ),
    [
      ["PUBLIC_SITE_URL must use HTTPS"],
      ["PUBLIC_SITE_URL must be an absolute HTTP(S) origin"],
    ],
  );
  assert.deepEqual(
    [
      adminEnvironment(safeProduction).publicSiteOrigin,
      adminEnvironment({
        ...safeProduction,
        PUBLIC_SITE_URL: "https://campusgamingnetwork.com/",
      }).publicSiteOrigin,
      adminEnvironment({ DEPLOYMENT_ENV: "local" }).publicSiteOrigin,
    ],
    [undefined, "https://campusgamingnetwork.com", "http://localhost:3000"],
  );
});

test("Access validation requires HTTPS outside local", () => {
  const plainHTTP = {
    CLOUDFLARE_ACCESS_TEAM_DOMAIN: "http://127.0.0.1:18085",
    CLOUDFLARE_ACCESS_JWKS_URL: "http://127.0.0.1:18085/cdn-cgi/access/certs",
  };
  assert.deepEqual(
    environmentValidationIssues({ DEPLOYMENT_ENV: "local", ...plainHTTP }),
    [],
  );
  assert.deepEqual(
    environmentValidationIssues({ ...safeProduction, ...plainHTTP }),
    [
      "CLOUDFLARE_ACCESS_TEAM_DOMAIN must be an absolute HTTPS origin",
      "CLOUDFLARE_ACCESS_JWKS_URL must be an absolute HTTPS URL",
    ],
  );
});

test("local Access identity requires an explicit loopback-only test configuration", () => {
  const localAccess = {
    DEPLOYMENT_ENV: "local",
    ADMIN_SITE_URL: "http://localhost:3002",
    ADMIN_LOCAL_ACCESS_EMAIL: "dev@campusgamingnetwork.test",
    CLOUDFLARE_ACCESS_TEAM_DOMAIN: "http://admin:3002",
    CLOUDFLARE_ACCESS_AUDIENCE: "cgn-local-admin",
    CLOUDFLARE_ACCESS_JWKS_URL: "http://admin:3002/cdn-cgi/access/certs",
  };
  assert.deepEqual(environmentValidationIssues(localAccess), []);
  assert.equal(
    adminEnvironment(localAccess).localAccessEmail,
    "dev@campusgamingnetwork.test",
  );

  assert.deepEqual(
    environmentValidationIssues({
      ...safeProduction,
      ADMIN_LOCAL_ACCESS_EMAIL: "dev@campusgamingnetwork.test",
    }).filter((issue) => issue.includes("ADMIN_LOCAL_ACCESS_EMAIL")),
    ["ADMIN_LOCAL_ACCESS_EMAIL is allowed only in local development"],
  );

  const unsafeLocalCases = [
    {
      ...localAccess,
      ADMIN_SITE_URL: "http://admin.example.test:3002",
    },
    {
      ...localAccess,
      ADMIN_LOCAL_ACCESS_EMAIL: "Admin@example.com",
    },
    {
      ...localAccess,
      CLOUDFLARE_ACCESS_JWKS_URL: "http://admin:3002/other-keys",
    },
  ];
  assert.deepEqual(
    unsafeLocalCases.map((value) =>
      environmentValidationIssues(value).some((issue) =>
        issue.includes("ADMIN_LOCAL_ACCESS_EMAIL"),
      ),
    ),
    [true, true, true],
  );
});

// Every security value fails closed, in staging as in production, and no
// refusal repeats a configured value.
test("each missing or unsafe security value refuses to start in strict environments", () => {
  const cases: {
    name: string;
    override: Record<string, string | undefined>;
    issue: string;
  }[] = [
    {
      name: "no API address",
      override: { ADMIN_API_INTERNAL_URL: undefined },
      issue: "ADMIN_API_INTERNAL_URL must be set",
    },
    {
      name: "a local API address",
      override: { ADMIN_API_INTERNAL_URL: "http://127.0.0.1:8080" },
      issue: "ADMIN_API_INTERNAL_URL must not use a local hostname",
    },
    {
      name: "a public plain-HTTP API address",
      override: { ADMIN_API_INTERNAL_URL: "http://api.example.com" },
      issue: "ADMIN_API_INTERNAL_URL must use HTTPS",
    },
    {
      name: "an API address with a path",
      override: { ADMIN_API_INTERNAL_URL: "https://api.example.com/admin" },
      issue: "ADMIN_API_INTERNAL_URL must be an absolute HTTP(S) origin",
    },
    {
      name: "no site address",
      override: { ADMIN_SITE_URL: undefined },
      issue: "ADMIN_SITE_URL must be set",
    },
    {
      name: "a plain-HTTP site address",
      override: { ADMIN_SITE_URL: "http://admin.campusgamingnetwork.com" },
      issue: "ADMIN_SITE_URL must use HTTPS",
    },
    {
      name: "a local site address",
      override: { ADMIN_SITE_URL: "https://localhost" },
      issue: "ADMIN_SITE_URL must not use a local hostname",
    },
    {
      name: "no proxy secret",
      override: { ADMIN_API_PROXY_SHARED_SECRET: undefined },
      issue:
        "ADMIN_API_PROXY_SHARED_SECRET must contain at least 32 characters",
    },
    {
      name: "a short proxy secret",
      override: { ADMIN_API_PROXY_SHARED_SECRET: "short" },
      issue:
        "ADMIN_API_PROXY_SHARED_SECRET must contain at least 32 characters",
    },
    {
      name: "the public site's secret",
      override: { ADMIN_API_PROXY_SHARED_SECRET: "b".repeat(48) },
      issue: "must differ from API_PROXY_SHARED_SECRET",
    },
    {
      name: "a relaxed session cookie",
      override: { ADMIN_SESSION_COOKIE: "cgn_admin_session" },
      issue: "ADMIN_SESSION_COOKIE must be __Host-cgn_admin_session",
    },
    {
      name: "a relaxed CSRF cookie",
      override: { ADMIN_CSRF_COOKIE: "cgn_admin_csrf" },
      issue: "ADMIN_CSRF_COOKIE must be __Host-cgn_admin_csrf",
    },
    {
      name: "no team domain",
      override: { CLOUDFLARE_ACCESS_TEAM_DOMAIN: undefined },
      issue: "CLOUDFLARE_ACCESS_TEAM_DOMAIN must be set",
    },
    {
      name: "a plain-HTTP team domain",
      override: {
        CLOUDFLARE_ACCESS_TEAM_DOMAIN: "http://cgn.cloudflareaccess.com",
      },
      issue: "CLOUDFLARE_ACCESS_TEAM_DOMAIN must be an absolute HTTPS origin",
    },
    {
      name: "no audience",
      override: { CLOUDFLARE_ACCESS_AUDIENCE: undefined },
      issue: "CLOUDFLARE_ACCESS_AUDIENCE must be set",
    },
    {
      name: "no key set address",
      override: { CLOUDFLARE_ACCESS_JWKS_URL: undefined },
      issue: "CLOUDFLARE_ACCESS_JWKS_URL must be set",
    },
    {
      name: "a plain-HTTP key set address",
      override: {
        CLOUDFLARE_ACCESS_JWKS_URL:
          "http://cgn.cloudflareaccess.com/cdn-cgi/access/certs",
      },
      issue: "CLOUDFLARE_ACCESS_JWKS_URL must be an absolute HTTPS URL",
    },
    {
      name: "no asset origin",
      override: { R2_PUBLIC_ASSET_ORIGIN: undefined },
      issue: "R2_PUBLIC_ASSET_ORIGIN must be set",
    },
    {
      name: "a plain-HTTP asset origin",
      override: {
        R2_PUBLIC_ASSET_ORIGIN: "http://assets.campusgamingnetwork.com",
      },
      issue: "R2_PUBLIC_ASSET_ORIGIN must be an HTTPS origin",
    },
    {
      name: "an unknown deployment",
      override: { DEPLOYMENT_ENV: "qa" },
      issue: "DEPLOYMENT_ENV must be local, staging, or production",
    },
  ];

  for (const deployment of ["staging", "production"]) {
    for (const { name, override, issue } of cases) {
      const environment: Record<string, string | undefined> = {
        ...safeProduction,
        DEPLOYMENT_ENV: deployment,
        ...override,
      };
      const issues = environmentValidationIssues(environment);

      assert.ok(
        issues.some((candidate) => candidate.includes(issue)),
        `${deployment}: ${name} must raise "${issue}", got ${JSON.stringify(issues)}`,
      );
      assert.throws(
        () => adminEnvironment(environment),
        /Unsafe Admin Console configuration/,
        `${deployment}: ${name} must not start`,
      );
      for (const secret of [
        safeProduction.ADMIN_API_PROXY_SHARED_SECRET,
        safeProduction.API_PROXY_SHARED_SECRET,
      ]) {
        assert.equal(
          issues.join(" ").includes(secret),
          false,
          `${name} repeats a secret`,
        );
      }
    }
  }
});
