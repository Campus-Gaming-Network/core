import assert from "node:assert/strict";
import { test } from "vite-plus/test";

import type * as Sentry from "@sentry/node";
import * as z from "zod";
import { ApiContractError, createApiClient } from "../src/server/api.server.js";
import {
  errorMonitoringConfig,
  errorMonitoringTestResponse,
  reportApiContractViolation,
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

test("an API contract violation is reported once, by area and failing field, without values", async () => {
  const captured: unknown[][] = [];
  const capture = ((...args: unknown[]) => {
    captured.push(args);
    return "event-id";
  }) as typeof Sentry.captureException;
  let violation: ApiContractError | undefined;
  const api = createApiClient({
    baseUrl: "http://api:8080",
    fetcher: async () =>
      Response.json({ id: "user-1", public_id: "", email: "a@example.test" }),
    onContractViolation: (error) => {
      violation = error;
      reportApiContractViolation(error, capture);
    },
  });

  await assert.rejects(
    () =>
      api({
        path: "/auth/login",
        method: "POST",
        responseSchema: z.object({
          id: z.string(),
          public_id: z.string().min(1),
          email: z.email(),
        }),
      }),
    ApiContractError,
  );
  assert.ok(violation);
  reportApiContractViolation(violation, capture);

  assert.deepEqual(captured, [
    [
      violation,
      {
        fingerprint: [
          "api-contract-violation",
          "/auth",
          "public_id: too_small",
        ],
        tags: { api_area: "/auth" },
        contexts: {
          api_contract: {
            path: "/auth/login",
            issues: ["public_id: too_small"],
          },
        },
      },
    ],
  ]);
});
