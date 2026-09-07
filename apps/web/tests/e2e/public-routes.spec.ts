import {
  expect,
  test,
  type Page,
  type Response as PlaywrightResponse
} from "@playwright/test";

const apiURL = "http://127.0.0.1:18080";
const publicRoutes = [
  { path: "/about", heading: /connects collegiate gaming communities/i },
  { path: "/faq", heading: "Frequently asked questions." },
  { path: "/terms", heading: "Terms placeholder" },
  { path: "/privacy", heading: "Privacy placeholder" }
];

test("logged-out static routes render without a /me request", async ({
  page,
  request
}) => {
  const reset = await request.post(`${apiURL}/__test/anonymous-me-count/reset`);
  expect(reset.ok()).toBe(true);

  await verifyPublicRoutes(page, async (response) => {
    expect(response.ok()).toBe(true);
  });

  const countResponse = await request.get(`${apiURL}/__test/anonymous-me-count`);
  expect(countResponse.ok()).toBe(true);
  await expect(countResponse.json()).resolves.toEqual({ count: 0 });
});

test("static routes degrade to logged-out navigation when /me is unavailable", async ({
  context,
  page
}) => {
  await context.addCookies([
    {
      name: "cgn_session",
      value: "api-outage",
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax"
    }
  ]);

  await verifyPublicRoutes(page, async (response) => {
    expect(response.ok()).toBe(true);
    await expect(response.json()).resolves.toEqual({ authenticated: false });
  });
});

test("authenticated navigation resolves to account controls", async ({ page }) => {
  await page.goto("/login?next=/about");
  await page.getByLabel("Email").fill("player@example.test");
  await page.getByLabel("Password").fill("Password12345!");
  await page.getByRole("button", { name: "Log in" }).click();

  await expect(page).toHaveURL(/\/about$/);
  const navigation = page.getByRole("navigation");
  await expect(navigation.getByRole("link", { name: "Account" })).toBeVisible();
  await expect(navigation.getByRole("button", { name: "Log out" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Log in" })).toHaveCount(0);

  await navigation.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(navigation.getByRole("link", { name: "Log in" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Account" })).toHaveCount(0);
});

test("authenticated-only pages still surface /me failures", async ({
  context,
  page
}) => {
  await context.addCookies([
    {
      name: "cgn_session",
      value: "api-outage",
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax"
    }
  ]);

  await page.goto("/account");
  await expect(
    page.getByRole("heading", { name: "We could not load this page." })
  ).toBeVisible();
});

async function verifyPublicRoutes(
  page: Page,
  verifyNavigationResponse: (response: PlaywrightResponse) => Promise<void>,
  index = 0
): Promise<void> {
  const route = publicRoutes[index];
  if (!route) {
    return;
  }

  const navigationSession = page.waitForResponse(
    (response) => response.url().endsWith("/api/navigation-session")
  );
  await page.goto(route.path);
  await expect(
    page.getByRole("heading", { name: route.heading, level: 1 })
  ).toBeVisible();
  await expect(
    page.getByRole("navigation").getByRole("link", { name: "Log in" })
  ).toBeVisible();
  await verifyNavigationResponse(await navigationSession);

  await verifyPublicRoutes(page, verifyNavigationResponse, index + 1);
}
