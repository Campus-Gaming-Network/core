import { expect, test } from "@playwright/test";
import { gotoApp } from "./fixtures/app-navigation.js";

test("the school header joins the alias and location beside Follow and the website, and key information gives the campus type", async ({
  page,
}) => {
  await gotoApp(page, "/schools/summit-ridge-university");
  const actions = page.locator("main .detail-heading__actions");
  const keyInformation = page
    .getByRole("region", { name: "Key information" })
    .locator("dt, dd");
  await expect(page.locator("main .detail-heading__supporting")).toHaveText(
    "SRU · Denver, CO",
  );
  await expect(keyInformation).toHaveText([
    "Location",
    "Denver, CO",
    "Campus type",
    "Main campus",
  ]);
  await expect(
    actions.getByRole("link", { name: "Follow school" }),
  ).toBeVisible();
  await expect(
    actions.getByRole("link", { name: "Visit school website" }),
  ).toHaveAttribute("href", "https://browser.example.test/gaming");

  await gotoApp(page, "/schools/quiet-valley-college");
  await expect(page.locator("main .detail-heading__supporting")).toHaveText(
    "QVC · Boise, ID",
  );
  await expect(keyInformation).toHaveText([
    "Location",
    "Boise, ID",
    "Campus type",
    "Branch campus",
  ]);
});

test("each school tab changes the sections shown", async ({ page }) => {
  await gotoApp(page, "/schools/summit-ridge-university");
  const tabs = page.getByRole("navigation", { name: "School sections" });
  const events = page.getByRole("heading", { name: "Upcoming events" });
  const teams = page.getByRole("heading", { name: "Teams", exact: true });
  await expect(events).toBeVisible();
  await expect(teams).toBeVisible();

  await tabs.getByRole("link", { name: "Teams" }).click();
  await expect(page).toHaveURL(/\?tab=teams$/);
  await expect(tabs.getByRole("link", { name: "Teams" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(teams).toBeVisible();
  await expect(events).toHaveCount(0);

  await tabs.getByRole("link", { name: "Events" }).click();
  await expect(page).toHaveURL(/\?tab=events$/);
  await expect(events).toBeVisible();
  await expect(teams).toHaveCount(0);

  await tabs.getByRole("link", { name: "Overview" }).click();
  await expect(page).toHaveURL(/\/schools\/summit-ridge-university$/);
  await expect(events).toBeVisible();
  await expect(teams).toBeVisible();
});

test("a school with nothing scheduled offers one primary action, a text link, and no tabs", async ({
  page,
}) => {
  await gotoApp(page, "/schools/quiet-valley-college");
  const empty = page.getByRole("region", { name: "No activity here yet" });
  await expect(empty.locator("a.button--primary")).toHaveText(
    "Create the first event",
  );
  await expect(empty.locator("a.link")).toHaveText("Start a team");
  await expect(
    page.getByRole("navigation", { name: "School sections" }),
  ).toHaveCount(0);
});

test("school page controls are at least 44px tall on a phone", async ({
  isMobile,
  page,
}) => {
  test.skip(!isMobile, "Touch target sizing only applies to coarse pointers");

  const undersized = () =>
    page
      .locator("main a, main button")
      .evaluateAll((controls) =>
        controls
          .filter((control) => control.getBoundingClientRect().height < 44)
          .map((control) => control.textContent?.trim()),
      );

  await gotoApp(page, "/schools/summit-ridge-university");
  expect(await undersized()).toEqual([]);

  await gotoApp(page, "/schools/quiet-valley-college");
  expect(await undersized()).toEqual([]);
});
