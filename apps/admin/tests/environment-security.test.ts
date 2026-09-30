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
