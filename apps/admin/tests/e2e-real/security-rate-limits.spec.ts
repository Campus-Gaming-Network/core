import { expect, test } from "@playwright/test";
import { accessAssertion } from "./fixtures/access.js";
import {
  adminOrigin,
  apiURL,
  exchangeSession,
  proxyHeaders,
} from "./fixtures/admin-api.js";

const limitedAdmin = "limited@admin-real.test";

function spoofedClient(attempt: number): Record<string, string> {
  return {
    "X-Forwarded-For": `203.0.113.${attempt % 250}`,
    "X-Real-IP": `198.51.100.${attempt % 250}`,
    "Cf-Connecting-IP": `192.0.2.${attempt % 250}`,
    Forwarded: `for=203.0.113.${attempt % 250}`,
  };
}

// RATE-02: limits follow the verified identity, so a client cannot evade them
// by varying the addresses it claims.
test("RATE-02: failed exchanges from one identity are limited whatever addresses it claims", async ({
  request,
}) => {
  // Validly signed, but no account: each attempt is a counted failure.
  const probe = accessAssertion("probe-without-account@admin-real.test");
  const attempt = (assertion: string, number: number) =>
    request.post(`${apiURL}/admin/v1/auth/exchange`, {
      headers: {
        ...proxyHeaders,
        ...spoofedClient(number),
        Origin: adminOrigin,
        "Cf-Access-Jwt-Assertion": assertion,
      },
    });

  const statuses: number[] = [];
  for (let number = 0; number < 8; number += 1) {
    // Sequential: the limit depends on the order of attempts.
    // eslint-disable-next-line no-await-in-loop
    statuses.push((await attempt(probe, number)).status());
  }
  expect(statuses).toEqual([403, 403, 403, 403, 403, 429, 429, 429]);

  const blocked = await attempt(probe, 99);
  expect(Number(blocked.headers()["retry-after"])).toBeGreaterThan(0);

  // Another identity is unaffected by the first one's failures.
  const other = await attempt(
    accessAssertion("other-without-account@admin-real.test"),
    100,
  );
  expect(other.status()).toBe(403);
});

test("RATE-02: an operator's reads stop at the limit whatever addresses they claim", async ({
  request,
}) => {
  const limited = await exchangeSession(request, limitedAdmin);
  const read = (number: number) =>
    request.get(`${apiURL}/admin/v1/session`, {
      headers: { ...limited.readHeaders, ...spoofedClient(number) },
    });

  const allowed = await Promise.all(
    Array.from({ length: 120 }, (_, number) => read(number)),
  );
  expect(allowed.map((response) => response.status())).toEqual(
    Array.from({ length: 120 }, () => 200),
  );

  const refused = await read(9999);
  expect(refused.status()).toBe(429);
  expect(Number(refused.headers()["retry-after"])).toBeGreaterThan(0);
  expect((await refused.json()).error).toBe("rate_limited");

  // Another operator from the same address keeps their own budget.
  const bystander = await exchangeSession(request, "bystander@admin-real.test");
  const unaffected = await request.get(`${apiURL}/admin/v1/session`, {
    headers: { ...bystander.readHeaders, ...spoofedClient(9999) },
  });
  expect(unaffected.status()).toBe(200);
});
