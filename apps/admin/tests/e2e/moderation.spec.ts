import { expect, test } from "@playwright/test";
import {
  authenticateAdmin,
  memberID,
  operatorID,
  reportID,
  ticketID,
} from "./fixtures/admin-session.js";

test.beforeEach(async ({ context, request }) => {
  const reset = await request.post("http://127.0.0.1:18082/__test/reset");
  expect(reset.ok()).toBe(true);
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
  await page
    .getByLabel("Submitter (name or email)")
    .fill("player@example.test");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page).toHaveURL(/status=resolved.*user=player%40example\.test/);
  await expect(
    page.getByRole("heading", {
      name: "No support tickets match these filters",
    }),
  ).toBeVisible();
});

test("a user page opens queues already filtered to that account", async ({
  page,
}) => {
  await page.goto(`/users/${memberID}`);
  await page.getByRole("link", { name: "View support tickets" }).click();

  await expect(page).toHaveURL(
    `/support-tickets?user=${encodeURIComponent(memberID)}&status=all`,
  );
  await expect(page.getByLabel("Submitter (name or email)")).toHaveValue(
    memberID,
  );
  await expect(page.getByLabel("Status")).toHaveValue("all");
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

test("the overview counts waiting work and an operator takes a ticket", async ({
  page,
}) => {
  await page.goto("/");
  const unassigned = page
    .getByRole("region", { name: "Support tickets" })
    .getByRole("link", { name: "Open and unassigned" });
  await expect(unassigned).toHaveText("Open and unassigned1");
  await unassigned.click();
  await expect(page).toHaveURL(
    "/support-tickets?status=open&assignee=unassigned",
  );

  await page.goto(`/support-tickets/${ticketID}`);
  await page.getByRole("button", { name: "Assign to me" }).click();
  await expect(page.getByLabel("Assignee")).toHaveValue(operatorID);
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page.getByRole("status")).toHaveText("Changes saved.");
  await expect(
    page.getByRole("link", { name: "Operator", exact: true }),
  ).toHaveAttribute("href", `/users/${operatorID}`);
});
