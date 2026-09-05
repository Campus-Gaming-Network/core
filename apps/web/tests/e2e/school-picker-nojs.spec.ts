import { expect, test } from "@playwright/test";

test.use({ javaScriptEnabled: false });

test("school search keeps a usable no-JavaScript select fallback", async ({
  page
}) => {
  await page.goto("/signup?q=Zzyzx");

  const fallback = page.locator('select[name="home_school_id"]');
  await expect(fallback).toBeVisible();
  await expect(
    fallback.getByRole("option", { name: /Zzyzx Institute of Technology/ })
  ).toHaveCount(1);
  await fallback.selectOption("school-zzyzx");
  await expect(fallback).toHaveValue("school-zzyzx");

  await page.goto("/signup?q=Failure+query");
  await expect(
    page.getByText("We couldn’t load schools. Try the search again.")
  ).toBeVisible();
});
