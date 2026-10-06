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

// On a touch screen :hover latches after a tap and reads as a stuck selected
// state, so hover styling is limited to pointers that can hover. The test
// lives in this file because it is the one the mobile project runs.
test("hover styles apply only where the pointer can hover", async ({
  context,
  page,
}, testInfo) => {
  await authenticateAdmin(context);
  await page.goto("/schools");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  const ungated = await page.evaluate(() => {
    const selectors: string[] = [];
    const visit = (rules: CSSRuleList, gated: boolean) => {
      for (const rule of rules) {
        if (
          !gated &&
          rule instanceof CSSStyleRule &&
          rule.selectorText.includes(":hover") &&
          rule.style.length > 0
        ) {
          selectors.push(rule.selectorText);
        }
        if (rule instanceof CSSGroupingRule || rule instanceof CSSStyleRule) {
          visit(
            rule.cssRules,
            gated ||
              (rule instanceof CSSMediaRule &&
                /hover:\s*hover/.test(rule.conditionText)),
          );
        }
      }
    };
    for (const sheet of document.styleSheets) visit(sheet.cssRules, false);
    return selectors;
  });
  expect(ungated).toEqual([]);

  const link = page
    .getByRole("navigation", { name: "Admin navigation" })
    .getByRole("link", { name: "Users" });
  const background = () =>
    link.evaluate((element) => getComputedStyle(element).backgroundColor);
  const resting = await background();
  await link.hover();
  expect((await background()) !== resting).toBe(
    testInfo.project.name !== "mobile-chromium",
  );
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
