import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";

const webURL = "http://127.0.0.1:3300";
const apiURL = "http://127.0.0.1:18082";
const resendURL = "http://127.0.0.1:18083";
const databaseURL = process.env.REAL_E2E_DATABASE_URL;
const nodeExecutable = JSON.stringify(process.execPath);
const goExecutable = JSON.stringify(process.env.REAL_E2E_GO_EXECUTABLE ?? "go");
const apiDirectory = fileURLToPath(new URL("../api", import.meta.url));

if (!databaseURL) {
  throw new Error("REAL_E2E_DATABASE_URL is required");
}

export default defineConfig({
  testDir: "./tests/e2e-real",
  testIgnore: "**/fixtures/**",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  repeatEach: process.env.CI ? 2 : 1,
  workers: 1,
  reporter: process.env.CI
    ? [
        ["github"],
        ["html", { open: "never", outputFolder: "playwright-report-real" }],
      ]
    : [["list"]],
  use: {
    baseURL: webURL,
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
      command: `${nodeExecutable} tests/e2e-real/fixtures/resend-stub.mjs`,
      url: `${resendURL}/health`,
      env: {
        PORT: "18083",
        RESEND_STUB_API_KEY: "real-e2e-resend-key",
      },
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `${goExecutable} run ./cmd/api`,
      cwd: apiDirectory,
      url: `${apiURL}/ready`,
      env: {
        DEPLOYMENT_ENV: "local",
        API_HTTP_ADDR: "127.0.0.1:18082",
        API_DATABASE_URL: databaseURL,
        API_SITE_URL: webURL,
        API_SESSION_COOKIE: "cgn_session",
        API_COOKIE_SECURE: "false",
        API_RESEND_API_KEY: "real-e2e-resend-key",
        API_RESEND_API_URL: `${resendURL}/emails`,
        API_ACCOUNT_EMAIL_FROM: "account@campusgamingnetwork.com",
        API_EVENTS_EMAIL_FROM: "events@campusgamingnetwork.com",
        API_AUTH_RATE_LIMIT: "3",
        API_AUTH_RATE_WINDOW: "15m",
        API_CATALOG_REFRESH_INTERVAL: "24h",
        API_PROXY_SHARED_SECRET: "real-e2e-proxy-secret-000000000000",
      },
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `${nodeExecutable} src/production-preflight.ts`,
      url: `${webURL}/api/health`,
      env: {
        NODE_ENV: "production",
        DEPLOYMENT_ENV: "local",
        API_INTERNAL_URL: apiURL,
        API_SESSION_COOKIE: "cgn_session",
        API_PROXY_SHARED_SECRET: "real-e2e-proxy-secret-000000000000",
        CLOUDFLARE_ORIGIN_SECRET: "real-e2e-cloudflare-secret-00000000",
        SITE_URL: webURL,
        HOST: "127.0.0.1",
        NITRO_HOST: "127.0.0.1",
        PORT: "3300",
      },
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
