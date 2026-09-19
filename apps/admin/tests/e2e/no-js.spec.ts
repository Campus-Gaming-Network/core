import { expect, test } from "@playwright/test";
import { authenticateAdmin, ticketID } from "./fixtures/admin-session.js";

test("the access boundary renders without JavaScript", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page.locator("main h1")).toHaveCount(1);
  await expect(
    page.getByText(
      "A current Access identity and an active CGN site-admin grant are required.",
    ),
  ).toBeVisible();
  await expect(page.getByText("Admin overview")).toHaveCount(0);
});

test("the native moderation form updates a ticket and renders its audit", async ({
  context,
  page,
}) => {
  await authenticateAdmin(context);
  const response = await page.goto(`/support-tickets/${ticketID}`);
  expect(response?.status()).toBe(200);

  await page.getByLabel("Status").selectOption("resolved");
  await page
    .getByLabel("Resolution note")
    .fill("Resolved through the native form");
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page).toHaveURL(/notice=updated/);
  await expect(page.getByText("Changes saved.")).toBeVisible();
  await expect(page.getByText("Support ticket updated")).toBeVisible();
});
