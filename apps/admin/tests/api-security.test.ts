import assert from "node:assert/strict";
import test from "node:test";
import * as z from "zod";
import {
  AdminApiContractError,
  AdminApiError,
  createAdminApiClient,
  withAccessIdentity,
  type ApiClient,
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

test("the Admin API client forwards a multipart body with its own boundary", async () => {
  let request: RequestInit | undefined;
  const api = createAdminApiClient({
    baseURL: "http://api.internal",
    proxySecret: "server-owned-secret",
    fetcher: async (_input, init) => {
      request = init;
      return Response.json({ ok: true });
    },
  });
  const body = new FormData();
  body.set("reason", "Official logo");

  await api({
    path: "/admin/v1/schools/id/logo",
    method: "POST",
    body,
    responseSchema: z.object({ ok: z.literal(true) }),
  });

  assert.equal(request?.body, body);
  assert.equal(new Headers(request?.headers).has("Content-Type"), false);
});

test("only a server-verified identity reaches the API as the session's Access identity", async () => {
  const sent: (string | null)[] = [];
  const api = createAdminApiClient({
    baseURL: "http://api.internal",
    proxySecret: "server-owned-secret",
    fetcher: async (_input, init) => {
      sent.push(new Headers(init?.headers).get("X-CGN-Admin-Access-Email"));
      return Response.json({ ok: true });
    },
  });
  const responseSchema = z.object({ ok: z.literal(true) });

  // A value smuggled in through headers is dropped; only the typed option sets it.
  await api({
    path: "/admin/v1/session",
    responseSchema,
    headers: { "X-CGN-Admin-Access-Email": "browser@example.test" },
  });
  await api({
    path: "/admin/v1/session",
    responseSchema,
    headers: { "X-CGN-Admin-Access-Email": "browser@example.test" },
    accessEmail: "verified@example.test",
  });

  assert.deepEqual(sent, [null, "verified@example.test"]);
});

test("every call verifies the Access identity once and never reaches the API without it", async () => {
  const responseSchema = z.object({ ok: z.literal(true) });
  const reached: (string | undefined)[] = [];
  const base = (async ({ accessEmail }) => {
    reached.push(accessEmail);
    return { data: { ok: true }, response: Response.json({ ok: true }) };
  }) as ApiClient;

  let verifications = 0;
  const verified = withAccessIdentity(base, async () => {
    verifications += 1;
    return { email: "verified@example.test" };
  });
  await verified({ path: "/a", responseSchema });
  await verified({ path: "/b", responseSchema });
  assert.deepEqual(reached, ["verified@example.test", "verified@example.test"]);
  assert.equal(verifications, 1);

  reached.length = 0;
  let rejections = 0;
  const unverified = withAccessIdentity(base, async () => {
    rejections += 1;
    throw new Error("assertion rejected");
  });
  for (const path of ["/a", "/b"]) {
    // Sequential: the second call must reuse the first call's verdict.
    // eslint-disable-next-line no-await-in-loop
    await assert.rejects(
      unverified({ path, responseSchema }),
      (error) => error instanceof AdminApiError && error.status === 401,
    );
  }
  assert.deepEqual(reached, []);
  assert.equal(rejections, 1);

  // An unverified identity that is never used is not an unhandled rejection.
  withAccessIdentity(base, async () => {
    throw new Error("never awaited");
  });

  // A local console with no Access configuration sends no identity.
  reached.length = 0;
  await withAccessIdentity(
    base,
    async () => undefined,
  )({
    path: "/a",
    responseSchema,
  });
  assert.deepEqual(reached, [undefined]);
});
