import { expect, test } from "@playwright/test";
import { gotoApp } from "./fixtures/app-navigation.js";

const apiURL = "http://127.0.0.1:18081";
const siteOrigin = "http://127.0.0.1:3200";

test.beforeEach(async ({ request }) => {
  const response = await request.post(`${apiURL}/__test/reset`);
  expect(response.ok()).toBe(true);
});

test("an event's link can be copied from its page", async ({
  context,
  page,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: siteOrigin,
  });
  await gotoApp(page, "/events/public-browser-event");

  const url = `${siteOrigin}/events/public-browser-event`;
  await expect(page.getByLabel("Event link")).toHaveValue(url);

  await page.getByRole("button", { name: "Copy link" }).click();

  await expect(
    page.getByRole("status").filter({ hasText: "Link copied" }),
  ).toHaveCount(1);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
});
