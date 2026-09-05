import assert from "node:assert/strict";
import test from "node:test";
import * as z from "zod";
import {
  apiRequestFromBFF,
  cloudflareSecretHeader,
  normalizeIPAddress,
  proxySecretHeader,
  visitorIPFromHostingHeaders,
  visitorIPHeader
} from "../lib/bff-api.js";
import type { Fetcher } from "../lib/cgn-api.js";

test("normalizes Railway IPv4 and IPv6 visitor addresses", () => {
  assert.equal(normalizeIPAddress(" 198.51.100.42 "), "198.51.100.42");
  assert.equal(
    normalizeIPAddress("2001:0db8:0000:0000:0000:0000:0000:0042"),
    "2001:db8::42"
  );
  assert.equal(normalizeIPAddress("198.51.100.42:8080"), null);
  assert.equal(normalizeIPAddress("198.51.100.42, 203.0.113.7"), null);
  assert.equal(normalizeIPAddress("fe80::1%eth0"), null);
  assert.equal(normalizeIPAddress("not-an-address"), null);
});

test("uses Railway's single-value X-Real-IP at the direct hosting boundary", () => {
  assert.equal(
    visitorIPFromHostingHeaders(
      new Headers({
        "x-real-ip": "203.0.113.9",
        "x-forwarded-for": "198.51.100.1, 198.51.100.2",
        "x-cgn-visitor-ip": "192.0.2.99"
      })
    ),
    "203.0.113.9"
  );
  assert.equal(
    visitorIPFromHostingHeaders(
      new Headers({ "x-forwarded-for": "203.0.113.9" })
    ),
    null
  );
});

test("trusts Cloudflare visitor identity only with the origin secret", () => {
  const trustedHeaders = new Headers({
    "x-real-ip": "192.0.2.10",
    "cf-connecting-ip": "203.0.113.42",
    [cloudflareSecretHeader]: "cloudflare-origin-secret"
  });

  assert.equal(
    visitorIPFromHostingHeaders(trustedHeaders, "cloudflare-origin-secret"),
    "203.0.113.42"
  );
  assert.equal(
    visitorIPFromHostingHeaders(trustedHeaders, "wrong-secret"),
    "192.0.2.10"
  );
  assert.equal(visitorIPFromHostingHeaders(trustedHeaders), "192.0.2.10");
});

test("forwards authenticated visitor identity on every limited BFF flow", async () => {
  const limitedPaths = [
    "/auth/signup",
    "/auth/login",
    "/auth/resend-verification",
    "/auth/forgot-password",
    "/auth/reset-password",
    "/support-tickets",
    "/events",
    "/events/private-event/unlock",
    "/events/private-event/report",
    "/users/user-id/report",
    "/teams",
    "/teams/example-team/join"
  ];
  const calls: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
  const fetcher: Fetcher = async (input, init) => {
    calls.push({ input, init });
    return Response.json({ ok: true });
  };

  await Promise.all(
    limitedPaths.map((path) =>
      apiRequestFromBFF(
        {
          path,
          method: "POST",
          headers: {
            "x-cgn-visitor-ip": "192.0.2.99",
            "x-cgn-proxy-secret": "browser-value"
          },
          baseUrl: "http://api:8080",
          fetcher,
          responseSchema: z.object({ ok: z.boolean() })
        },
        {
          incomingHeaders: new Headers({ "x-real-ip": "203.0.113.42" }),
          proxySecret: "shared-secret"
        }
      )
    )
  );

  assert.equal(calls.length, limitedPaths.length);
  for (const call of calls) {
    const outgoingHeaders = new Headers(call.init?.headers);
    assert.equal(outgoingHeaders.get(visitorIPHeader), "203.0.113.42");
    assert.equal(outgoingHeaders.get(proxySecretHeader), "shared-secret");
  }
});

test("removes internal identity when the source or shared secret is invalid", async () => {
  const calls: RequestInit[] = [];
  const fetcher: Fetcher = async (_input, init) => {
    calls.push(init ?? {});
    return Response.json({ ok: true });
  };
  const options = {
    path: "/auth/signup",
    method: "POST",
    headers: {
      "x-cgn-visitor-ip": "192.0.2.99",
      "x-cgn-proxy-secret": "browser-value"
    },
    baseUrl: "http://api:8080",
    fetcher,
    responseSchema: z.object({ ok: z.boolean() })
  };

  await apiRequestFromBFF(options, {
    incomingHeaders: new Headers({ "x-real-ip": "not-an-address" }),
    proxySecret: "shared-secret"
  });
  await apiRequestFromBFF(options, {
    incomingHeaders: new Headers({ "x-real-ip": "203.0.113.42" }),
    proxySecret: ""
  });

  for (const init of calls) {
    const outgoingHeaders = new Headers(init.headers);
    assert.equal(outgoingHeaders.get(visitorIPHeader), null);
    assert.equal(outgoingHeaders.get(proxySecretHeader), null);
  }
});
