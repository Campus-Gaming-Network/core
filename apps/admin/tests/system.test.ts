import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { getSystemOperation } from "../src/features/system/system-operations.server.js";
import type { ApiClient } from "../src/server/api.server.js";

const status = {
  checks: [
    { name: "object_storage", status: "ok" },
    { name: "igdb", status: "not_configured" },
  ],
  email_outbox: {
    pending: 2,
    retrying: 1,
    failed: 0,
    oldest_pending_at: "2026-09-20T12:00:00.123456Z",
  },
};

test("the system page reads one validated status document", async () => {
  const paths: string[] = [];
  const api = (async (options) => {
    paths.push(options.path);
    return {
      data: options.responseSchema.parse(status),
      response: Response.json({}),
    };
  }) as ApiClient;

  assert.deepEqual(
    {
      system: await getSystemOperation({ api, cookieHeader: "admin" }),
      paths,
    },
    { system: status, paths: ["/admin/v1/system"] },
  );
});
