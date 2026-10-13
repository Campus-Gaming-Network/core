import { expect, test } from "@playwright/test";
import { authenticateAdmin } from "./fixtures/admin-session.js";

const apiURL = "http://127.0.0.1:18082";

test.beforeEach(async ({ request }) => {
  const response = await request.post(`${apiURL}/__test/reset`);
  expect(response.ok()).toBe(true);
});

test("the content security policy admits only the error monitoring origin", async ({
  request,
}) => {
  const response = await request.get("/");

  expect(response.headers()["content-security-policy"]).toContain(
    `; connect-src 'self' ${apiURL}; `,
  );
});

test("a browser error is reported without the page's query string", async ({
  context,
  page,
}) => {
  await authenticateAdmin(context);
  await page.route(`${apiURL}/api/1/envelope/**`, (route) =>
    route.fulfill({ json: {} }),
  );
  await page.goto("/users?q=query-secret");
  await expect(page.locator("html")).toHaveAttribute(
    "data-error-monitoring",
    "true",
  );

  const reported = page.waitForRequest(`${apiURL}/api/1/envelope/**`);
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error("browser error monitoring test");
    });
  });
  const envelope = (await reported).postData() ?? "";

  expect(envelope).toContain("browser error monitoring test");
  expect(envelope).toContain('"runtime":"browser"');
  expect(envelope).toContain('"environment":"local"');
  expect(envelope).toContain('"release":"browser-test-release"');
  expect(envelope).toContain('"url":"http://127.0.0.1:3202/users"');
  expect(envelope).not.toContain("query-secret");
  expect(envelope).not.toContain("operator@example.test");
});

test("the server test error is reported without request data", async ({
  request,
}) => {
  const response = await request.post(
    "/api/error-monitoring-test?token=query-secret",
    {
      headers: {
        authorization: "Bearer browser-test-maintenance-token",
        cookie: "cgn_admin_session=cookie-secret",
      },
    },
  );
  expect(response.status()).toBe(500);

  await expect
    .poll(async () =>
      (await request.get(`${apiURL}/__test/error-envelopes`)).json(),
    )
    .toHaveLength(1);
  const [envelope] = (await (
    await request.get(`${apiURL}/__test/error-envelopes`)
  ).json()) as string[];

  expect(envelope).toContain("error monitoring test");
  expect(envelope).toContain('"runtime":"server"');
  expect(envelope).toContain('"release":"browser-test-release"');
  expect(envelope).not.toContain("query-secret");
  expect(envelope).not.toContain("cookie-secret");
  expect(envelope).not.toContain("browser-test-maintenance-token");
});
