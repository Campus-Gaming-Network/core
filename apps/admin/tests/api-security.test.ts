import assert from "node:assert/strict";
import test from "node:test";
import * as z from "zod";
import {
  AdminApiContractError,
  createAdminApiClient,
} from "../src/server/api.server.js";

test("the Admin API client replaces browser-supplied trust headers", async () => {
  let request:
    | { input: string | URL | Request; init?: RequestInit }
    | undefined;
  const api = createAdminApiClient({
    baseURL: "http://api.internal",
    proxySecret: "server-owned-secret",
    fetcher: async (input, init) => {
      request = { input, init };
      return Response.json({ ok: true });
    },
  });

  await api({
    path: "/admin/v1/session",
    responseSchema: z.object({ ok: z.literal(true) }),
    headers: { "X-CGN-Admin-Proxy-Secret": "browser-controlled" },
  });

  assert.equal(String(request?.input), "http://api.internal/admin/v1/session");
  const headers = new Headers(request?.init?.headers);
  assert.equal(headers.get("X-CGN-Admin-Proxy-Secret"), "server-owned-secret");
  assert.equal(request?.init?.cache, "no-store");
  assert.equal(request?.init?.redirect, "error");
});

test("unexpected privileged response fields fail the explicit contract", async () => {
  const api = createAdminApiClient({
    baseURL: "http://api.internal",
    proxySecret: "server-owned-secret",
    fetcher: async () => Response.json({ role: "school_admin" }),
  });

  await assert.rejects(
    api({
      path: "/admin/v1/session",
      responseSchema: z.object({ role: z.literal("site_admin") }),
    }),
    AdminApiContractError,
  );
});

test("the Admin API client serializes PATCH bodies without forwarding trust headers", async () => {
  let request:
    | { input: string | URL | Request; init?: RequestInit }
    | undefined;
  const api = createAdminApiClient({
    baseURL: "http://api.internal",
    proxySecret: "server-owned-secret",
    fetcher: async (input, init) => {
      request = { input, init };
      return Response.json({ status: "closed" });
    },
  });

  await api({
    path: "/admin/v1/reports/report-id",
    method: "PATCH",
    body: { status: "closed" },
    responseSchema: z.object({ status: z.literal("closed") }),
    headers: {
      "X-CGN-Admin-Proxy-Secret": "browser-controlled",
      "X-CGN-Admin-CSRF": "server-read-csrf",
    },
  });

  assert.equal(request?.init?.method, "PATCH");
  assert.equal(request?.init?.body, JSON.stringify({ status: "closed" }));
  const headers = new Headers(request?.init?.headers);
  assert.equal(headers.get("content-type"), "application/json");
  assert.equal(headers.get("x-cgn-admin-csrf"), "server-read-csrf");
  assert.equal(headers.get("x-cgn-admin-proxy-secret"), "server-owned-secret");
});
