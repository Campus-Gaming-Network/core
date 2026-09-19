import { expect, test } from "@playwright/test";
import {
  authenticateAdmin,
  reportID,
  ticketID,
} from "./fixtures/admin-session.js";

test.beforeEach(async ({ context }) => {
  await authenticateAdmin(context);
});

test("queues are keyboard reachable and stored markup remains inert", async ({
  page,
}) => {
  await page.goto("/reports");
  await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
  await expect(page.getByText("<img", { exact: false })).toHaveCount(0);
  await expect(page.locator("main img")).toHaveCount(0);

  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to main content" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();

  await page.goto("/support-tickets");
  await expect(
    page.getByRole("link", {
      name: /<script>document\.body\.dataset\.xss="ticket"<\/script>/,
    }),
  ).toBeVisible();
  await expect(page.locator("main script")).toHaveCount(0);
  expect(await page.locator("body").getAttribute("data-xss")).toBeNull();

  await page.getByLabel("Status").selectOption("resolved");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page).toHaveURL(/status=resolved/);
  await expect(
    page.getByRole("heading", {
      name: "No support tickets match these filters",
    }),
  ).toBeVisible();
});

test("stale report updates preserve input, show current state, and retry", async ({
  page,
}) => {
  await page.goto(`/reports/${reportID}`);
  await expect(page.getByText("<img src=x", { exact: false })).toBeVisible();
  await expect(page.locator("main img")).toHaveCount(0);
  expect(await page.locator("body").getAttribute("data-xss")).toBeNull();

  await page.getByLabel("Status").selectOption("closed");
  await page.getByLabel("Resolution note").fill("Force conflict once");
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page.getByRole("alert")).toContainText(
    "This item changed after you opened it",
  );
  await expect(page.getByLabel("Resolution note")).toHaveValue(
    "Force conflict once",
  );
  await expect(
    page.getByRole("heading", { name: "Current saved state" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("heading", { name: "Current saved state" })
      .locator("..")
      .getByText("In review"),
  ).toBeVisible();

  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(/notice=updated/);
  await expect(page.getByRole("status")).toHaveText("Changes saved.");
  await expect(page.getByText("Report updated")).toBeVisible();
  await expect(page.getByText("Resolution note changed")).toBeVisible();
});

test("support detail exposes private data only on the scoped detail page", async ({
  page,
}) => {
  await page.goto(`/support-tickets/${ticketID}`);
  await expect(page.getByText("player@example.test")).toBeVisible();
  await expect(page.getByText("<svg onload=", { exact: false })).toBeVisible();
  await expect(page.locator("main svg")).toHaveCount(0);
  expect(await page.locator("body").getAttribute("data-xss")).toBeNull();
});
