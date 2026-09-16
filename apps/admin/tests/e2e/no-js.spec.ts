import { expect, test } from "@playwright/test";

test("the access boundary renders without JavaScript", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page.locator("main h1")).toHaveCount(1);
  await expect(
    page.getByText("A current Access identity and an active CGN site-admin grant are required.")
  ).toBeVisible();
  await expect(page.getByText("Admin overview")).toHaveCount(0);
});
