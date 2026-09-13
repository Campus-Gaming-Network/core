import {
  expect,
  test,
  type APIResponse
} from "@playwright/test";

const apiURL = "http://127.0.0.1:18081";
const defaultReferrerPolicy = "strict-origin-when-cross-origin";

test.beforeEach(async ({ request }) => {
  const response = await request.post(`${apiURL}/__test/reset`);
  expect(response.ok()).toBe(true);
});

test("security headers cover HTML, redirects, errors, and API responses", async ({
  page,
  request
}) => {
  const responses = await Promise.all([
    request.get("/"),
    request.get("/missing-security-header-route"),
    request.get("/events/new", { maxRedirects: 0 }),
    request.get("/api/health"),
    request.post("/api/health", { maxRedirects: 0 })
  ]);
  const expectedStatuses = [200, 404, 307, 200, 405];

  for (const [index, response] of responses.entries()) {
    expect(response.status()).toBe(expectedStatuses[index]);
    assertCommonSecurityHeaders(response, defaultReferrerPolicy);
  }

  expect(responses[2]?.headers().location).toBe("/login?next=/events/new");
  expect(responses[3]?.headers()["cache-control"]).toBe("no-store");
  expect(responses[4]?.headers().allow).toBe("GET, HEAD");

  await page.goto("/login");
  const loginAction = await page
    .locator('form[method="post"]')
    .first()
    .getAttribute("action");
  expect(loginAction).toBeTruthy();

  const rejectedCSRF = await request.post(loginAction ?? "/", {
    form: {
      email: "cross-origin@example.test",
      password: "E2EPassword123!"
    },
    headers: { origin: "https://attacker.example" },
    maxRedirects: 0
  });
  expect(rejectedCSRF.status()).toBe(403);
  assertCommonSecurityHeaders(rejectedCSRF, defaultReferrerPolicy);
});

test("token-bearing pages and their legacy redirect never send a referrer", async ({
  request
}) => {
  const tokenResponses = await Promise.all(
    [
      "/reset-password?token=security-header-reset-token",
      "/auth/verify-email?token=security-header-verification-token"
    ].map((path) => request.get(path))
  );
  for (const response of tokenResponses) {
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("private, no-store");
    assertCommonSecurityHeaders(response, "no-referrer");
  }

  const legacyRedirect = await request.get(
    "/auth/reset-password?token=security-header-legacy-token",
    { maxRedirects: 0 }
  );
  expect(legacyRedirect.status()).toBe(307);
  expect(legacyRedirect.headers().location).toBe(
    "/reset-password?token=security-header-legacy-token"
  );
  expect(legacyRedirect.headers()["cache-control"]).toBe("private, no-store");
  assertCommonSecurityHeaders(legacyRedirect, "no-referrer");

  const legacyRedirectWithoutToken = await request.get(
    "/auth/reset-password",
    { maxRedirects: 0 }
  );
  expect(legacyRedirectWithoutToken.status()).toBe(307);
  expect(legacyRedirectWithoutToken.headers().location).toBe("/reset-password");
  expect(legacyRedirectWithoutToken.headers()["cache-control"]).toBe(
    "private, no-store"
  );
  assertCommonSecurityHeaders(legacyRedirectWithoutToken, "no-referrer");
});

test("the local HTTP harness does not emit an ineffective HSTS header", async ({
  request
}) => {
  const response = await request.get("/");
  expect(response.headers()["strict-transport-security"]).toBeUndefined();
});

function assertCommonSecurityHeaders(
  response: APIResponse,
  expectedReferrerPolicy: "no-referrer" | typeof defaultReferrerPolicy
): void {
  const headers = response.headers();
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["content-security-policy"]).toContain("base-uri 'self'");
  expect(headers["content-security-policy"]).toContain("object-src 'none'");
  expect(headers["permissions-policy"]).toBe(
    "camera=(), microphone=(), geolocation=(), payment=()"
  );
  expect(headers["referrer-policy"]).toBe(expectedReferrerPolicy);
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
}
