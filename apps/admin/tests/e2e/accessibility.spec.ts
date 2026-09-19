import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { authenticateAdmin, reportID } from "./fixtures/admin-session.js";

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
