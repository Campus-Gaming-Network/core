import { expect, test } from "@playwright/test";
import { gotoApp } from "./fixtures/app-navigation.js";

const apiURL = "http://127.0.0.1:18081";
const version = "draft-2026-10-06";

test.beforeEach(async ({ request }) => {
  const response = await request.post(`${apiURL}/__test/reset`);
  expect(response.ok()).toBe(true);
});

test("signup links to the exact Terms and Privacy versions it records", async ({
  page,
}) => {
  await gotoApp(page, "/signup");

  const accept = page.getByRole("checkbox", { name: /agree to the Terms/ });
  await expect(accept).not.toBeChecked();
  await expect(accept).toHaveAttribute("required", "");
  const links = [
    ["Terms", "/terms", "Terms placeholder"],
    ["Privacy Policy", "/privacy", "Privacy placeholder"],
  ] as const;
  for (const [name, path] of links) {
    // The footer links to the latest version; the form names an exact one.
    await expect(
      page.getByRole("main").getByRole("link", { name, exact: true }),
    ).toHaveAttribute("href", `${path}?version=${version}`);
  }

  for (const [, path, heading] of links) {
    await gotoApp(page, `${path}?version=${version}`);
    await expect(
      page.getByRole("heading", { name: heading, level: 1 }),
    ).toBeVisible();
    await expect(page.getByText(`Version ${version}, effective`)).toBeVisible();
  }
});

test("a policy version that was never published is not found", async ({
  page,
}) => {
  for (const path of ["/terms", "/privacy"]) {
    const response = await page.request.get(`${path}?version=never-published`);
    expect(response.status(), path).toBe(404);
  }
});

test("a signup naming a version that is no longer current asks the person to reload", async ({
  page,
}) => {
  await gotoApp(page, "/signup?q=Browser");
  await page.getByLabel("Name").fill("Stale Policy Player");
  await page.getByLabel("Email").fill("stale-policy@example.test");
  await page.getByLabel("Password").fill("E2EPassword123!");
  await page.getByLabel("Home school").selectOption("school-e2e");
  await page.getByRole("checkbox", { name: /18 or older/ }).check();
  await page.getByRole("checkbox", { name: /agree to the Terms/ }).check();
  // The page was rendered before a newer version was published.
  await page
    .locator('input[name="terms_version"]')
    .evaluate((input: HTMLInputElement) => {
      input.value = "draft-2026-01-01";
    });
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByRole("alert")).toContainText(
    "Our Terms or Privacy Policy changed. Reload this page, review them, and try again.",
  );
});
