import { defineConfig, devices } from "@playwright/test";

const webURL = "http://127.0.0.1:3100";
const apiURL = "http://127.0.0.1:18080";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: {
    timeout: 10_000
  },
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
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
      use: { ...devices["Desktop Chrome"] }
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 5"] }
    }
  ],
  webServer: [
    {
      command: "node tests/e2e/fixtures/fake-api.mjs",
      url: `${apiURL}/health`,
      reuseExistingServer: false,
      timeout: 30_000
    },
    {
      command: "npm run dev -- --port 3100",
      url: `${webURL}/api/health`,
      env: {
        API_INTERNAL_URL: apiURL,
        NEXT_PUBLIC_SITE_URL: webURL,
        NEXT_TELEMETRY_DISABLED: "1"
      },
      reuseExistingServer: false,
      timeout: 120_000
    }
  ]
});
