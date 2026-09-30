import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";

const adminURL = "http://127.0.0.1:3310";
const apiURL = "http://127.0.0.1:18090";
const accessURL = "http://127.0.0.1:18085";
const objectStoreURL = "http://127.0.0.1:18086";
const databaseURL = process.env.REAL_E2E_DATABASE_URL;
const nodeExecutable = JSON.stringify(process.execPath);
const goExecutable = JSON.stringify(process.env.REAL_E2E_GO_EXECUTABLE ?? "go");
const apiDirectory = fileURLToPath(new URL("../api", import.meta.url));
const adminProxySecret = "real-e2e-admin-proxy-secret-0000000";
const accessAudience = "admin-real-e2e-audience";
const bucket = "cgn-school-logos";
const assetOrigin = `${objectStoreURL}/${bucket}`;

if (!databaseURL || !process.env.ADMIN_REAL_E2E_PUBLIC_JWK) {
  throw new Error(
    "Run this suite through `pnpm run test:e2e:admin:real`; it provisions the database and Access key",
  );
}

export default defineConfig({
  testDir: "./tests/e2e-real",
  testIgnore: "**/fixtures/**",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // The journeys share one database and run in file order.
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: process.env.CI
    ? [
        ["github"],
        ["html", { open: "never", outputFolder: "playwright-report-real" }],
      ]
    : [["list"]],
  use: {
    baseURL: adminURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "real-stack-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: `${nodeExecutable} tests/e2e-real/fixtures/access-stub.mjs`,
      url: `${accessURL}/health`,
      env: { PORT: "18085" },
      stderr: "pipe",
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `${nodeExecutable} tests/e2e-real/fixtures/object-store-stub.mjs`,
      url: `${objectStoreURL}/health`,
      env: { PORT: "18086" },
      stderr: "pipe",
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `${goExecutable} run ./cmd/api`,
      cwd: apiDirectory,
      url: `${apiURL}/ready`,
      env: {
        DEPLOYMENT_ENV: "local",
        API_HTTP_ADDR: "127.0.0.1:18090",
        API_DATABASE_URL: databaseURL,
        API_SITE_URL: "http://127.0.0.1:3300",
        API_PROXY_SHARED_SECRET: "real-e2e-proxy-secret-000000000000",
        API_CATALOG_REFRESH_INTERVAL: "24h",
        ADMIN_ENABLED: "true",
        ADMIN_SITE_URL: adminURL,
        ADMIN_API_PROXY_SHARED_SECRET: adminProxySecret,
        CLOUDFLARE_ACCESS_TEAM_DOMAIN: accessURL,
        CLOUDFLARE_ACCESS_AUDIENCE: accessAudience,
        CLOUDFLARE_ACCESS_JWKS_URL: `${accessURL}/cdn-cgi/access/certs`,
        R2_ENDPOINT: objectStoreURL,
        R2_SCHOOL_LOGOS_BUCKET: bucket,
        R2_ACCESS_KEY_ID: "real-e2e-access-key",
        R2_SECRET_ACCESS_KEY: "real-e2e-secret-key",
        R2_PUBLIC_ASSET_ORIGIN: assetOrigin,
      },
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
      stderr: "pipe",
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `${nodeExecutable} src/production-preflight.ts`,
      url: `${adminURL}/api/health`,
      env: {
        NODE_ENV: "production",
        DEPLOYMENT_ENV: "local",
        ADMIN_API_INTERNAL_URL: apiURL,
        ADMIN_API_PROXY_SHARED_SECRET: adminProxySecret,
        ADMIN_SITE_URL: adminURL,
        ADMIN_SESSION_COOKIE: "cgn_admin_session",
        ADMIN_CSRF_COOKIE: "cgn_admin_csrf",
        CLOUDFLARE_ACCESS_TEAM_DOMAIN: accessURL,
        CLOUDFLARE_ACCESS_AUDIENCE: accessAudience,
        CLOUDFLARE_ACCESS_JWKS_URL: `${accessURL}/cdn-cgi/access/certs`,
        R2_PUBLIC_ASSET_ORIGIN: assetOrigin,
        HOST: "127.0.0.1",
        NITRO_HOST: "127.0.0.1",
        PORT: "3310",
      },
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
      stderr: "pipe",
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
