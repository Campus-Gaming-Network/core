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
