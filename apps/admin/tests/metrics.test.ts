import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import {
  metricsSchema,
  stickiness,
} from "../src/features/metrics/contracts.js";
import { getMetricsOperation } from "../src/features/metrics/metrics-operations.server.js";
import type { ApiClient } from "../src/server/api.server.js";

const metrics = {
  as_of: "2026-10-20",
  active: { day: 3, week: 7, month: 12 },
  days: [{ day: "2026-10-20", active: 3, signups: 1 }],
  schools: [
    { id: "11111111-1111-4111-8111-111111111111", name: "Home U", active: 12 },
  ],
};

test("the metrics page reads one validated summary", async () => {
  const paths: string[] = [];
  const api = (async (options) => {
    paths.push(options.path);
    return {
      data: options.responseSchema.parse(metrics),
      response: Response.json({}),
    };
  }) as ApiClient;

  assert.deepEqual(
    {
      metrics: await getMetricsOperation({ api, cookieHeader: "admin" }),
      paths,
    },
    { metrics, paths: ["/admin/v1/metrics"] },
  );
});

test("a negative count fails the contract", () => {
  assert.equal(
    metricsSchema.safeParse({
      ...metrics,
      days: [{ day: "2026-10-20", active: -1, signups: 0 }],
    }).success,
    false,
  );
});

test("stickiness is today's share of the month, and a dash for an empty month", () => {
  assert.deepEqual(
    [
      stickiness({ day: 3, week: 7, month: 12 }),
      stickiness({ day: 0, week: 0, month: 0 }),
    ],
    ["25%", "—"],
  );
});
