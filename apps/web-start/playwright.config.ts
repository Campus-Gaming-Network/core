import { defineConfig, devices } from "@playwright/test";

const webURL = "http://127.0.0.1:3200";
const apiURL = "http://127.0.0.1:18081";
const nodeExecutable = JSON.stringify(process.execPath);
const developmentRuntime =
  process.env.START_BROWSER_RUNTIME === "development";

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
    baseURL: webURL,
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
      testIgnore: "**/no-js.spec.ts",
      use: { ...devices["Pixel 5"] }
    },
    {
      name: "no-javascript-chromium",
      testMatch: "**/no-js.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        javaScriptEnabled: false
      }
    }
  ],
  webServer: [
    {
      command: `${nodeExecutable} tests/e2e/fixtures/fake-api.mjs`,
      url: `${apiURL}/health`,
      env: { PORT: "18081" },
      reuseExistingServer: false,
      timeout: 30_000
    },
    {
      command: developmentRuntime
        ? `${nodeExecutable} node_modules/vite/bin/vite.js --host 127.0.0.1 --port 3200`
        : `${nodeExecutable} src/production-preflight.ts`,
      url: `${webURL}/api/health`,
      env: {
        ...(developmentRuntime ? {} : { NODE_ENV: "production" }),
        DEPLOYMENT_ENV: "local",
        API_INTERNAL_URL: apiURL,
        API_SESSION_COOKIE: "cgn_session",
        API_PROXY_SHARED_SECRET: "browser-test-proxy-secret-00000000",
        CLOUDFLARE_ORIGIN_SECRET: "browser-test-origin-secret-0000000",
        SITE_URL: webURL,
        HOST: "127.0.0.1",
        NITRO_HOST: "127.0.0.1",
        PORT: "3200"
      },
      reuseExistingServer: false,
      timeout: 30_000
    }
  ]
});
