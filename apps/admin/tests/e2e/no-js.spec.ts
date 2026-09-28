import { expect, test } from "@playwright/test";
import { authenticateAdmin, ticketID } from "./fixtures/admin-session.js";

test("the native catalog form creates a game", async ({
  context,
  page,
  request,
}) => {
  const reset = await request.post("http://127.0.0.1:18082/__test/reset");
  expect(reset.ok()).toBe(true);
  await authenticateAdmin(context);
  await page.goto("/games");
  const create = page.getByRole("region", { name: "Add a game" });
  await create.getByLabel("Name").fill("Native Tactics");
  await create.getByLabel("Slug").fill("native-tactics");
  await create.getByLabel("Reason").fill("Added without JavaScript");
  await create.getByRole("button", { name: "Create game" }).click();

  await expect(page).toHaveURL(/\/games\/[0-9a-f-]{36}\?notice=created$/);
  await expect(page.getByText("Created.")).toBeVisible();
  await expect(page.getByText("Game created")).toBeVisible();
});

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
