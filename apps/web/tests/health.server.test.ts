import assert from "node:assert/strict";
import test from "node:test";

import {
  apiHealthResponse,
  methodNotAllowedResponse
} from "../src/server/health.server.js";

test("health route preserves the healthy public response contract", async () => {
  let requestedURL = "";
  const response = await apiHealthResponse({
    apiBaseURL: "http://api.internal",
    fetcher: async (input) => {
      requestedURL = String(input);
      return Response.json({ service: "campus-gaming-network-api", status: "ok" });
    }
  });

  assert.equal(requestedURL, "http://api.internal/health");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    service: "campus-gaming-network-web",
    status: "ok",
    api: { service: "campus-gaming-network-api", status: "ok" }
  });
});

test("health route maps an unhealthy API to a degraded response", async () => {
  const response = await apiHealthResponse({
    apiBaseURL: "http://api.internal",
    fetcher: async () => Response.json({ status: "degraded" }, { status: 503 })
  });

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    service: "campus-gaming-network-web",
    status: "degraded",
    api: { status: "degraded" }
  });
});

test("health route reports an unreachable API without leaking the error", async () => {
  const response = await apiHealthResponse({
    apiBaseURL: "http://api.internal",
    fetcher: async () => {
      throw new Error("connection contained a secret");
    }
  });

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    service: "campus-gaming-network-web",
    status: "degraded",
    reason: "api_unreachable"
  });
});

test("health route strips additive upstream fields and rejects malformed success", async () => {
  const additive = await apiHealthResponse({
    apiBaseURL: "http://api.internal",
    fetcher: async () => Response.json({
      service: "campus-gaming-network-api",
      status: "ok",
      database_url: "postgres://private"
    })
  });
  assert.deepEqual(await additive.json(), {
    service: "campus-gaming-network-web",
    status: "ok",
    api: { service: "campus-gaming-network-api", status: "ok" }
  });

  const malformed = await apiHealthResponse({
    apiBaseURL: "http://api.internal",
    fetcher: async () => Response.json({ status: { private: true } })
  });
  assert.equal(malformed.status, 503);
  assert.deepEqual(await malformed.json(), {
    service: "campus-gaming-network-web",
    status: "degraded",
    api: { status: "unknown" }
  });
});

test("health route rejects unsupported methods with its public contract", () => {
  const response = methodNotAllowedResponse();

  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET, HEAD");
});
