import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { authenticateAdmin } from "./fixtures/admin-session.js";

test("the color theme switches immediately and persists across reloads", async ({
  context,
  page,
}) => {
  await authenticateAdmin(context);
  await page.goto("/");

  const root = page.locator("html");
  const toggle = page.getByRole("button", {
    name: "Switch between light and dark mode",
  });
  await expect(root).toHaveAttribute("data-theme", "light");
  await expect(toggle.getByText("Dark mode", { exact: true })).toBeVisible();
  await expect(toggle.getByText("Light mode", { exact: true })).toBeHidden();
  const lightBackground = await root.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );

  await toggle.click();
  await expect(root).toHaveAttribute("data-theme", "dark");
  await expect(toggle.getByText("Light mode", { exact: true })).toBeVisible();
  await expect(toggle.getByText("Dark mode", { exact: true })).toBeHidden();
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  const darkBackground = await root.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  expect(darkBackground).not.toBe(lightBackground);

  await page.reload();
  await expect(root).toHaveAttribute("data-theme", "dark");
  await expect(toggle.getByText("Light mode", { exact: true })).toBeVisible();

  await toggle.click();
  await expect(root).toHaveAttribute("data-theme", "light");
});
