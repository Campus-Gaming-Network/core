import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import test from "node:test";
import * as z from "zod";
import {
  ApiContractError,
  ApiError,
  createApiClient,
  safeApiErrorMessage
} from "../src/server/api.server.js";
import { createGoBFFClient } from "../src/server/bff.server.js";
import {
  proxySecretHeader,
  visitorIPHeader
} from "../src/server/visitor-identity.server.js";

const currentDirectory = process.cwd();
const appRoot =
  basename(currentDirectory) === "web-start"
    ? currentDirectory
    : join(currentDirectory, "apps/web-start");

test("framework-neutral API and BFF mechanics stay outside the TanStack adapter", () => {
  for (const file of ["api.server.ts", "bff.server.ts", "viewer.server.ts"]) {
    const source = readFileSync(join(appRoot, "src/server", file), "utf8");
    assert.doesNotMatch(source, /@tanstack\/react-start/);
  }

  const requestBoundary = readFileSync(
    join(appRoot, "src/server/request-boundary.server.ts"),
    "utf8"
  );
  assert.match(requestBoundary, /@tanstack\/react-start\/server/);
});

test("BFF requests sanitize internal headers and assert trusted visitor identity", async () => {
  let call: { input: string | URL | Request; init?: RequestInit } | undefined;
  const api = createGoBFFClient({
    incomingHeaders: new Headers({ "x-real-ip": "203.0.113.42" }),
    proxySecret: "server-proxy-secret",
    trustRailwayHeaders: true,
    baseUrl: "http://api:8080/",
    fetcher: async (input, init) => {
      call = { input, init };
      return Response.json({ ok: true, secret: "strip-me" });
    }
  });

  const result = await api({
    path: "test",
    method: "POST",
    cookieHeader: "cgn_session=session-value",
    headers: {
      [visitorIPHeader]: "192.0.2.99",
      [proxySecretHeader]: "browser-secret"
    },
    body: { choice: "yes" },
    responseSchema: z.object({ ok: z.boolean() })
  });

  const outgoing = new Headers(call?.init?.headers);
  assert.equal(call?.input, "http://api:8080/test");
  assert.equal(call?.init?.cache, "no-store");
  assert.equal(call?.init?.body, JSON.stringify({ choice: "yes" }));
  assert.equal(outgoing.get("cookie"), "cgn_session=session-value");
  assert.equal(outgoing.get(visitorIPHeader), "203.0.113.42");
  assert.equal(outgoing.get(proxySecretHeader), "server-proxy-secret");
  assert.deepEqual(result.data, { ok: true });
});

test("all successful API payloads pass their Zod contract", async () => {
  const api = createApiClient({
    baseUrl: "http://api:8080",
    fetcher: async () => Response.json({ ok: "not-a-boolean" })
  });

  await assert.rejects(
    () => api({ path: "/test", responseSchema: z.object({ ok: z.boolean() }) }),
    (error: unknown) => error instanceof ApiContractError && error.path === "/test"
  );
});

test("upstream errors retain status internally but expose only allowlisted messages", async () => {
  const api = createApiClient({
    baseUrl: "http://api:8080",
    fetcher: async () =>
      Response.json({ error: "database-password-was-wrong" }, { status: 500 })
  });

  let caught: unknown;
  try {
    await api({ path: "/test", responseSchema: z.undefined() });
  } catch (error) {
    caught = error;
  }

  assert.ok(caught instanceof ApiError);
  assert.equal(caught.status, 500);
  assert.equal(safeApiErrorMessage(caught), "Something went wrong. Please try again.");
  assert.equal(safeApiErrorMessage(caught).includes("password"), false);
});
