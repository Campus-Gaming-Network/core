import assert from "node:assert/strict";
import test from "node:test";
import {
  cloudflareSecretHeader,
  headersWithTrustedVisitorIdentity,
  normalizeIPAddress,
  proxySecretHeader,
  sanitizeInternalHeaders,
  visitorIPFromHostingHeaders,
  visitorIPHeader
} from "../src/server/visitor-identity.server.js";

test("normalizes only single IPv4 and IPv6 visitor addresses", () => {
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
      }),
      "",
      true
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
    null
  );
  assert.equal(visitorIPFromHostingHeaders(trustedHeaders), null);
  assert.equal(
    visitorIPFromHostingHeaders(trustedHeaders, "wrong-secret", true),
    "192.0.2.10"
  );
});

test("removes browser-supplied internal headers without mutating the input", () => {
  const input = new Headers({
    "content-type": "application/json",
    [cloudflareSecretHeader]: "browser-cloudflare-value",
    [proxySecretHeader]: "browser-proxy-value",
    [visitorIPHeader]: "192.0.2.99"
  });
  const sanitized = sanitizeInternalHeaders(input);

  assert.equal(sanitized.get("content-type"), "application/json");
  assert.equal(sanitized.get(cloudflareSecretHeader), null);
  assert.equal(sanitized.get(proxySecretHeader), null);
  assert.equal(sanitized.get(visitorIPHeader), null);
  assert.equal(input.get(proxySecretHeader), "browser-proxy-value");
});

test("adds normalized visitor identity only as an authenticated pair", () => {
  const trusted = headersWithTrustedVisitorIdentity({
    incomingHeaders: new Headers({ "x-real-ip": "203.0.113.42" }),
    outgoingHeaders: {
      [proxySecretHeader]: "browser-value",
      [visitorIPHeader]: "192.0.2.99"
    },
    proxySecret: "server-owned-secret",
    trustRailwayHeaders: true
  });

  assert.equal(trusted.get(visitorIPHeader), "203.0.113.42");
  assert.equal(trusted.get(proxySecretHeader), "server-owned-secret");

  for (const headers of [
    headersWithTrustedVisitorIdentity({
      incomingHeaders: new Headers({ "x-real-ip": "not-an-address" }),
      outgoingHeaders: {
        [proxySecretHeader]: "browser-value",
        [visitorIPHeader]: "192.0.2.99"
      },
      proxySecret: "server-owned-secret",
      trustRailwayHeaders: true
    }),
    headersWithTrustedVisitorIdentity({
      incomingHeaders: new Headers({ "x-real-ip": "203.0.113.42" }),
      outgoingHeaders: {
        [proxySecretHeader]: "browser-value",
        [visitorIPHeader]: "192.0.2.99"
      },
      proxySecret: "",
      trustRailwayHeaders: true
    })
  ]) {
    assert.equal(headers.get(visitorIPHeader), null);
    assert.equal(headers.get(proxySecretHeader), null);
  }
});
