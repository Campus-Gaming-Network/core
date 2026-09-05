import { expect, test } from "@playwright/test";

test("school pagination preserves filters and browser history", async ({ page }) => {
  await page.goto("/schools?q=pagination&state=CA");

  await expect(
    page.getByRole("link", { name: "Pagination University 01" })
  ).toBeVisible();
  const next = page.getByRole("link", { name: "Next" });
  await expect(next).toHaveAttribute(
    "href",
    "/schools?q=pagination&state=CA&page=2"
  );

  await next.click();
  await expect(page).toHaveURL(/\/schools\?q=pagination&state=CA&page=2$/);
  await expect(
    page.getByRole("link", { name: "Pagination University 26" })
  ).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\/schools\?q=pagination&state=CA$/);
  await expect(
    page.getByRole("link", { name: "Pagination University 01" })
  ).toBeVisible();
});
