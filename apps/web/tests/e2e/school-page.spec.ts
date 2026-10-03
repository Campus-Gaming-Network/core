import { expect, test } from "@playwright/test";
import { gotoApp } from "./fixtures/app-navigation.js";

test("the school header joins the alias, location, and campus type beside Follow and the website", async ({
  page,
}) => {
  await gotoApp(page, "/schools/summit-ridge-university");
  const actions = page.locator("main > header .school-community-actions");
  await expect(
    page.locator("main > header .school-community-facts"),
  ).toHaveText("SRU · Denver, CO · Main campus");
  await expect(
    actions.getByRole("link", { name: "Follow school" }),
  ).toBeVisible();
  await expect(
    actions.getByRole("link", { name: "Visit school website" }),
  ).toHaveAttribute("href", "https://browser.example.test/gaming");

  await gotoApp(page, "/schools/quiet-valley-college");
  await expect(
    page.locator("main > header .school-community-facts"),
  ).toHaveText("QVC · Boise, ID · Branch campus");
});

test("the school tabs mark the section a keyboard jump lands on", async ({
  page,
}) => {
  await gotoApp(page, "/schools/summit-ridge-university");
  const tabs = page.getByRole("navigation", { name: "School sections" });
  const current = () =>
    tabs
      .getByRole("link")
      .evaluateAll((links) =>
        links.map((link) => link.getAttribute("aria-current")),
      );
  await expect.poll(current).toEqual(["location", null, null]);

  await tabs.getByRole("link", { name: "Teams" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#school-teams$/);
  await expect.poll(current).toEqual([null, null, "location"]);

  await tabs.getByRole("link", { name: "Events" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#school-events$/);
  await expect.poll(current).toEqual([null, "location", null]);
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
