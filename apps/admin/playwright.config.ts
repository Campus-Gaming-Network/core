import { defineConfig, devices } from "@playwright/test";

const adminURL = "http://127.0.0.1:3202";
const apiURL = "http://127.0.0.1:18082";
const nodeExecutable = JSON.stringify(process.execPath);

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"]],
  use: {
    baseURL: adminURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  },
  projects: [
    {
      name: "desktop-chromium",
      testIgnore: "**/no-js.spec.ts",
      use: { ...devices["Desktop Chrome"] }
    },
    {
      name: "mobile-chromium",
      testMatch: "**/accessibility.spec.ts",
      use: { ...devices["Pixel 5"] }
    },
    {
      name: "no-javascript-chromium",
      testMatch: "**/no-js.spec.ts",
      use: { ...devices["Desktop Chrome"], javaScriptEnabled: false }
    }
  ],
  webServer: [
    {
      command: `${nodeExecutable} tests/e2e/fixtures/fake-api.mjs`,
      url: `${apiURL}/health`,
      env: { PORT: "18082" },
      reuseExistingServer: false,
      timeout: 30_000
    },
    {
      command: `${nodeExecutable} .output/server/index.mjs`,
      url: `${adminURL}/api/health`,
      env: {
        NODE_ENV: "production",
        DEPLOYMENT_ENV: "local",
        ADMIN_API_INTERNAL_URL: apiURL,
        ADMIN_API_PROXY_SHARED_SECRET: "browser-test-admin-proxy-secret-00000000",
        ADMIN_SITE_URL: adminURL,
        ADMIN_SESSION_COOKIE: "cgn_admin_session",
        ADMIN_CSRF_COOKIE: "cgn_admin_csrf",
        HOST: "127.0.0.1",
        NITRO_HOST: "127.0.0.1",
        PORT: "3202"
      },
      reuseExistingServer: false,
      timeout: 30_000
    }
  ]
});
