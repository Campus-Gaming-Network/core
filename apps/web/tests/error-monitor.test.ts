import assert from "node:assert/strict";
import test from "node:test";

import {
  errorMonitoringConfig,
  errorMonitoringTestResponse,
} from "../src/server/error-monitor.server.js";

test("error monitoring is disabled without a DSN", () => {
  assert.equal(errorMonitoringConfig({ DEPLOYMENT_ENV: "production" }), null);
});

test("error monitoring tags events with the deployment and its commit", () => {
  assert.deepEqual(
    errorMonitoringConfig({
      DEPLOYMENT_ENV: "Staging",
      RAILWAY_GIT_COMMIT_SHA: "railway-sha",
      SENTRY_DSN: " https://public@sentry.example.test/1 ",
    }),
    {
      dsn: "https://public@sentry.example.test/1",
      environment: "staging",
      release: "railway-sha",
    },
  );
});

test("the test error stays disabled until a maintenance token is set", () => {
  const request = new Request("https://campus.example.test/", {
    headers: { authorization: "Bearer " },
    method: "POST",
  });

  assert.equal(errorMonitoringTestResponse(request, {}).status, 404);
});

test("the test error requires the maintenance token", () => {
  const environment = { WEB_MAINTENANCE_TOKEN: "maintenance-token" };

  assert.equal(
    errorMonitoringTestResponse(
      new Request("https://campus.example.test/", {
        headers: { authorization: "Bearer other" },
        method: "POST",
      }),
      environment,
    ).status,
    401,
  );
  assert.throws(
    () =>
      errorMonitoringTestResponse(
        new Request("https://campus.example.test/", {
          headers: { authorization: "Bearer maintenance-token" },
          method: "POST",
        }),
        environment,
      ),
    new Error("error monitoring test"),
  );
});
