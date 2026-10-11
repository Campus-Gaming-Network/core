import { expect, test } from "@playwright/test";
import { authenticateAdmin } from "./fixtures/admin-session.js";

const apiURL = "http://127.0.0.1:18082";

test.beforeEach(async ({ request }) => {
  const response = await request.post(`${apiURL}/__test/reset`);
  expect(response.ok()).toBe(true);
});

test("the audit log lists a change with its record, operator, and reason", async ({
  context,
  page,
}) => {
  await authenticateAdmin(context);
  await page.goto("/schools/new");
  await page.getByLabel("Name", { exact: true }).fill("Night Owl College");
  await page.getByLabel("Slug").fill("night-owl-college");
  await page.getByLabel("Reason").fill("New member school");
  await page.getByRole("button", { name: "Create school" }).click();
  await expect(page).toHaveURL(/\/schools\/[0-9a-f-]{36}\?notice=created$/);
  const schoolPath = new URL(page.url()).pathname;

  await page.goto("/audit-log");
  await expect(
    page.getByRole("heading", { level: 1, name: "Audit log" }),
  ).toBeVisible();
  const rows = page
    .getByRole("table", { name: "Audit log" })
    .locator("tbody tr");
  await expect(rows).toHaveCount(1);
  await expect(rows.getByRole("cell")).toContainText([
    "2026",
    "School created",
    "Night Owl College",
    "Operator",
    "slug",
    "New member school",
  ]);

  await page.getByLabel("Changes to").selectOption("game");
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(page).toHaveURL(/\/audit-log\?entity_type=game$/);
  await expect(
    page.getByRole("heading", {
      name: "No administrative changes match this filter",
    }),
  ).toBeVisible();

  await page.goto("/audit-log");
  await page.getByRole("link", { name: "Night Owl College" }).click();
  await expect(page).toHaveURL(new RegExp(`${schoolPath}$`));
});
