import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  authenticateAdmin,
  catalogSchoolID,
  memberID,
  reportID,
} from "./fixtures/admin-session.js";

test("the denied-by-default shell is accessible at desktop and mobile sizes", async ({
  page,
}) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("main")).toHaveCount(1);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    results.violations.map((violation) => ({
      id: violation.id,
      targets: violation.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
});

test("the moderation queue and detail are accessible at desktop and mobile sizes", async ({
  context,
  page,
}) => {
  await authenticateAdmin(context);
  await assertAccessiblePath(page, "/reports");
  await assertAccessiblePath(page, `/reports/${reportID}`);
});

for (const path of [
  "/schools",
  `/schools/${catalogSchoolID}`,
  "/games",
  "/users",
  `/users/${memberID}`,
  "/access/site-admins",
  "/step-up?return=%2Fusers",
]) {
  test(`${path} is accessible at desktop and mobile sizes`, async ({
    context,
    page,
  }) => {
    await authenticateAdmin(context);
    await assertAccessiblePath(page, path);
  });
}

// iOS Safari zooms the page when a focused control's text is under 16px.
for (const path of [
  "/schools",
  `/schools/${catalogSchoolID}`,
  "/users",
  `/users/${memberID}`,
]) {
  test(`${path} form controls are at least 16px`, async ({ context, page }) => {
    await authenticateAdmin(context);
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const sizes = await page
      .locator(
        "main :is(input:not([type=checkbox], [type=radio], [type=hidden]), select, textarea)",
      )
      .evaluateAll((controls) =>
        controls.map((control) =>
          parseFloat(getComputedStyle(control).fontSize),
        ),
      );
    expect(sizes.length).toBeGreaterThan(0);
    expect(sizes.filter((size) => size < 16)).toEqual([]);
  });
}

async function assertAccessiblePath(page: Page, path: string): Promise<void> {
  const response = await page.goto(path);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    results.violations.map((violation) => ({
      id: violation.id,
      targets: violation.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
}
