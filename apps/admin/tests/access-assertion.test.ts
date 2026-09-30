import assert from "node:assert/strict";
import { generateKeyPairSync, createSign } from "node:crypto";
import test, { beforeEach } from "node:test";
import {
  AccessAssertionError,
  clearAccessKeyCache,
  validateAccessAssertion,
} from "../src/server/access-assertion.server.js";

const issuer = "https://cgn.cloudflareaccess.com";
const audience = "admin-audience";
const jwksURL = `${issuer}/cdn-cgi/access/certs`;
const config = { issuer, audience, jwksURL };
const now = new Date("2026-09-30T12:00:00Z");
const nowSeconds = Math.floor(now.getTime() / 1000);

beforeEach(() => clearAccessKeyCache());

function newKey(keyID: string) {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    keyID,
    privateKey: pair.privateKey,
    jwk: {
      ...pair.publicKey.export({ format: "jwk" }),
      kid: keyID,
      alg: "RS256",
      use: "sig",
    },
  };
}

function segment(value: object) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function sign(
  key: ReturnType<typeof newKey>,
  claims: Record<string, unknown> = {},
  header: Record<string, unknown> = {},
) {
  const head = segment({ alg: "RS256", typ: "JWT", kid: key.keyID, ...header });
  const body = segment({
    iss: issuer,
    sub: "access-subject",
    email: "Operator@Example.Test",
    aud: [audience],
    iat: nowSeconds - 60,
    nbf: nowSeconds - 60,
    exp: nowSeconds + 3600,
    ...claims,
  });
  const signature = createSign("RSA-SHA256")
    .update(`${head}.${body}`)
    .sign(key.privateKey)
    .toString("base64url");
  return `${head}.${body}.${signature}`;
}

// A JWKS endpoint that serves whatever `keys` currently holds and counts reads.
function jwks(initial: ReturnType<typeof newKey>[]) {
  const state = {
    keys: initial,
    fetches: 0,
    body: undefined as string | undefined,
    status: 200,
  };
  const fetcher = (async () => {
    state.fetches += 1;
    return new Response(
      state.body ?? JSON.stringify({ keys: state.keys.map((key) => key.jwk) }),
      { status: state.status },
    );
  }) as typeof fetch;
  return { state, fetcher };
}

function validate(assertion: string, fetcher: typeof fetch, at = now) {
  return validateAccessAssertion(assertion, config, { fetcher, now: () => at });
}

// ACCESS-04
test("a correctly signed token yields only the normalized subject and email", async () => {
  const key = newKey("key-1");
  const { fetcher } = jwks([key]);

  const identity = await validate(sign(key), fetcher);

  assert.deepEqual(identity, {
    email: "operator@example.test",
    subject: "access-subject",
  });
});

// ACCESS-03
test("every invalid claim set is rejected", async () => {
  const key = newKey("key-1");
  const { fetcher } = jwks([key]);
  const cases: { name: string; claims: Record<string, unknown> }[] = [
    {
      name: "a wrong issuer",
      claims: { iss: "https://evil.cloudflareaccess.com" },
    },
    { name: "a wrong audience", claims: { aud: ["other-app"] } },
    { name: "a missing audience", claims: { aud: [] } },
    { name: "an expired token", claims: { exp: nowSeconds - 31 } },
    {
      name: "a token issued in the future",
      claims: { iat: nowSeconds + 3600, exp: nowSeconds + 7200 },
    },
    { name: "a token not yet valid", claims: { nbf: nowSeconds + 3600 } },
    { name: "an expiry before issuance", claims: { exp: nowSeconds - 120 } },
    { name: "a missing subject", claims: { sub: undefined } },
    { name: "an empty subject", claims: { sub: "" } },
    { name: "a missing email", claims: { email: undefined } },
    { name: "a malformed email", claims: { email: "not-an-email" } },
  ];

  const results = await Promise.all(
    cases.map(({ claims }) =>
      validate(sign(key, claims), fetcher).then(
        () => "accepted",
        (error: unknown) =>
          error instanceof AccessAssertionError ? error.reason : "other",
      ),
    ),
  );

  assert.deepEqual(
    results,
    cases.map(() => "invalid"),
  );
});

test("the configured audience may be one of several", async () => {
  const key = newKey("key-1");
  const { fetcher } = jwks([key]);

  await validate(sign(key, { aud: ["other-app", audience] }), fetcher);
  await validate(sign(key, { aud: audience }), fetcher);
});

test("a token inside the clock-skew allowance is accepted and outside it is not", async () => {
  const key = newKey("key-1");
  const { fetcher } = jwks([key]);

  await validate(sign(key, { exp: nowSeconds - 29 }), fetcher);
  await assert.rejects(
    validate(sign(key, { exp: nowSeconds - 31 }), fetcher),
    AccessAssertionError,
  );
});

test("malformed, unsigned, re-signed, and wrong-key tokens are rejected", async () => {
  const key = newKey("key-1");
  const attacker = newKey("key-1");
  const { fetcher } = jwks([key]);
  const valid = sign(key);
  const [head, body] = valid.split(".");
  const cases: { name: string; assertion: string }[] = [
    { name: "empty", assertion: "" },
    { name: "arbitrary text", assertion: "not-a-jwt" },
    { name: "two segments", assertion: `${head}.${body}` },
    { name: "an empty signature", assertion: `${head}.${body}.` },
    {
      name: "alg none",
      assertion: `${Buffer.from(JSON.stringify({ alg: "none", kid: "key-1" })).toString("base64url")}.${body}.`,
    },
    { name: "HS256", assertion: sign(key, {}, { alg: "HS256" }) },
    {
      name: "a tampered body",
      assertion: `${head}.${Buffer.from(JSON.stringify({ iss: issuer, sub: "x", email: "admin@example.test", aud: [audience], iat: nowSeconds - 60, exp: nowSeconds + 3600 })).toString("base64url")}.${valid.split(".")[2]}`,
    },
    { name: "another key under the same id", assertion: sign(attacker) },
    { name: "an oversized token", assertion: "a".repeat(64 * 1024 + 1) },
  ];

  const results = await Promise.all(
    cases.map(({ assertion }) =>
      validate(assertion, fetcher).then(
        () => "accepted",
        (error: unknown) =>
          error instanceof AccessAssertionError ? error.reason : "other",
      ),
    ),
  );

  assert.deepEqual(
    results,
    cases.map(({ name }) => (name === "empty" ? "missing" : "invalid")),
  );
});

test("an incomplete configuration denies every token", async () => {
  const key = newKey("key-1");
  const { fetcher } = jwks([key]);
  for (const partial of [
    { issuer, audience },
    { issuer, jwksURL },
    { audience, jwksURL },
  ]) {
    // Sequential: each case resets nothing, and all must deny.
    // eslint-disable-next-line no-await-in-loop
    await assert.rejects(
      validateAccessAssertion(sign(key), partial, { fetcher, now: () => now }),
      (error) =>
        error instanceof AccessAssertionError && error.reason === "unavailable",
    );
  }
});

// ACCESS-05
test("signing keys are cached, and a rotated-in key id earns one refresh", async () => {
  const first = newKey("key-1");
  const second = newKey("key-2");
  const endpoint = jwks([first]);

  await validate(sign(first), endpoint.fetcher);
  await validate(sign(first), endpoint.fetcher);
  assert.equal(
    endpoint.state.fetches,
    1,
    "a known key is served from the cache",
  );

  // Access rotates: the next token is signed by a key the cache has not seen,
  // once the unknown-key cooldown has passed.
  endpoint.state.keys = [first, second];
  const later = new Date(now.getTime() + 31_000);
  await validate(
    sign(second, {
      iat: nowSeconds + 30,
      nbf: nowSeconds + 30,
      exp: nowSeconds + 7200,
    }),
    endpoint.fetcher,
    later,
  );
  assert.equal(endpoint.state.fetches, 2);
});

test("invented key ids cannot spend a signing-key fetch on every request", async () => {
  const key = newKey("key-1");
  const endpoint = jwks([key]);
  await validate(sign(key), endpoint.fetcher);
  assert.equal(endpoint.state.fetches, 1);

  const attacker = newKey("invented");
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      validate(
        sign({ ...attacker, keyID: `invented-${index}` }),
        endpoint.fetcher,
      ).then(
        () => "accepted",
        (error: unknown) =>
          error instanceof AccessAssertionError ? error.reason : "other",
      ),
    ),
  );

  assert.deepEqual(
    results,
    Array.from({ length: 20 }, () => "invalid"),
  );
  assert.equal(endpoint.state.fetches, 1, "no refresh inside the cooldown");

  // After the cooldown an unknown id earns one refresh, and only one.
  const later = new Date(now.getTime() + 31_000);
  await validate(
    sign({ ...attacker, keyID: "invented-later" }),
    endpoint.fetcher,
    later,
  ).catch(() => undefined);
  await validate(
    sign({ ...attacker, keyID: "invented-later-2" }),
    endpoint.fetcher,
    later,
  ).catch(() => undefined);
  assert.equal(endpoint.state.fetches, 2);
});

test("a failed, malformed, or oversized key fetch denies access and never uses stale keys", async () => {
  const key = newKey("key-1");
  const token = sign(key);
  const endpoint = jwks([key]);
  await validate(token, endpoint.fetcher);

  // Once the cache window has passed, every fetch failure denies, even for a
  // key that used to be valid.
  const expired = new Date(now.getTime() + 6 * 60 * 1000);
  const longLived = sign(key, { exp: nowSeconds + 7200 });
  const failures: { name: string; arrange: () => void }[] = [
    {
      name: "a server error",
      arrange: () => {
        endpoint.state.status = 503;
      },
    },
    {
      name: "malformed JSON",
      arrange: () => {
        endpoint.state.status = 200;
        endpoint.state.body = "{not json";
      },
    },
    {
      name: "the wrong shape",
      arrange: () => {
        endpoint.state.body = JSON.stringify({ keys: [{ kty: "EC" }] });
      },
    },
    {
      name: "an oversized body",
      arrange: () => {
        endpoint.state.body = "x".repeat(1024 * 1024 + 1);
      },
    },
  ];
  for (const failure of failures) {
    failure.arrange();
    // Sequential: the endpoint state is shared.
    // eslint-disable-next-line no-await-in-loop
    await assert.rejects(
      validate(longLived, endpoint.fetcher, expired),
      (error) =>
        error instanceof AccessAssertionError && error.reason === "unavailable",
      failure.name,
    );
  }

  // A network failure denies as well.
  await assert.rejects(
    validate(
      longLived,
      (async () => {
        throw new Error("network down");
      }) as typeof fetch,
      expired,
    ),
    (error) =>
      error instanceof AccessAssertionError && error.reason === "unavailable",
  );
});

test("keys that are not RS256 signing keys are never used", async () => {
  const key = newKey("key-1");
  const endpoint = jwks([key]);
  endpoint.state.body = JSON.stringify({
    keys: [
      { ...key.jwk, use: "enc" },
      { ...key.jwk, kid: "other", alg: "RS512" },
    ],
  });

  await assert.rejects(
    validate(sign(key), endpoint.fetcher),
    AccessAssertionError,
  );
  await assert.rejects(
    validate(sign({ ...key, keyID: "other" }), endpoint.fetcher),
    AccessAssertionError,
  );
});
