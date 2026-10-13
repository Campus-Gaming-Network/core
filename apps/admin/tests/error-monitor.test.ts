import assert from "node:assert/strict";
import test from "node:test";

import {
  errorMonitoringConfig,
  errorMonitoringConnectSource,
  errorMonitoringTestResponse,
} from "../src/server/error-monitor.server.js";

test("error monitoring is disabled without a DSN", () => {
  const environment = { DEPLOYMENT_ENV: "production" };

  assert.equal(errorMonitoringConfig(environment), null);
  assert.equal(errorMonitoringConnectSource(environment), "");
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

test("the browser may connect only to the DSN's ingest origin", () => {
  assert.equal(
    errorMonitoringConnectSource({
      SENTRY_DSN: " https://public@sentry.example.test/1 ",
    }),
    "https://sentry.example.test",
  );
  assert.equal(
    errorMonitoringConnectSource({ SENTRY_DSN: "not a url; script-src *" }),
    "",
  );
});

test("the test error stays disabled until a maintenance token is set", () => {
  const request = new Request("https://admin.example.test/", {
    headers: { authorization: "Bearer " },
    method: "POST",
  });

  assert.equal(errorMonitoringTestResponse(request, {}).status, 404);
});

test("the test error requires the maintenance token", () => {
  const environment = { ADMIN_MAINTENANCE_TOKEN: "maintenance-token" };

  assert.equal(
    errorMonitoringTestResponse(
      new Request("https://admin.example.test/", {
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
        new Request("https://admin.example.test/", {
          headers: { authorization: "Bearer maintenance-token" },
          method: "POST",
        }),
        environment,
      ),
    new Error("error monitoring test"),
  );
});
