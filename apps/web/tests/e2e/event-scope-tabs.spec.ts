import { expect, test, type Page } from "@playwright/test";
import { gotoApp, logIn, waitForAppReady } from "./fixtures/app-navigation.js";

const apiURL = "http://127.0.0.1:18081";

test.beforeEach(async ({ request }) => {
  const reset = await request.post(`${apiURL}/__test/reset`);
  expect(reset.ok()).toBe(true);
  const seeded = await request.post(`${apiURL}/__test/scope-events`);
  expect(seeded.ok()).toBe(true);
});

function scopeTabs(page: Page) {
  return page.getByRole("navigation", { name: "Event scope" });
}

function eventTitles(page: Page) {
  return page.locator(".directory-row .directory-row__name");
}

test("each scope tab filters the list, sets a shareable URL, and keeps the other filters", async ({
  page,
}) => {
  await logIn(page, "scope-player@example.test", "/events?audience=open");
  const tabs = scopeTabs(page);
  await expect(tabs.getByRole("link")).toHaveText([
    "All events",
    "My school",
    "Online",
    "Tournaments",
  ]);
  await expect(tabs.getByRole("link", { name: "All events" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(eventTitles(page)).toHaveText([
    "Home Campus LAN",
    "Online Ladder Night",
    "Summit Ridge Spring Cup",
  ]);

  const steps = [
    {
      tab: "My school",
      search: "?school=browser-test-university&audience=open",
      titles: ["Home Campus LAN"],
      format: "",
      type: "",
    },
    {
      tab: "Online",
      search: "?format=online&audience=open",
      titles: ["Online Ladder Night"],
      format: "online",
      type: "",
    },
    {
      tab: "Tournaments",
      search: "?audience=open&type=tournament",
      titles: ["Summit Ridge Spring Cup"],
      format: "",
      type: "tournament",
    },
    {
      tab: "All events",
      search: "?audience=open",
      titles: [
        "Home Campus LAN",
        "Online Ladder Night",
        "Summit Ridge Spring Cup",
      ],
      format: "",
      type: "",
    },
  ];
  for (const step of steps) {
    await tabs.getByRole("link", { name: step.tab }).click();
    await expect(page).toHaveURL(
      (url) => url.pathname === "/events" && url.search === step.search,
    );
    await waitForAppReady(page);
    await expect(tabs.locator("[aria-current]")).toHaveText(step.tab);
    await expect(eventTitles(page)).toHaveText(step.titles);
    await expect(page.getByLabel("Filter events by audience")).toHaveValue(
      "open",
    );
    await expect(page.getByLabel("Filter events by format")).toHaveValue(
      step.format,
    );
    await expect(page.getByLabel("Filter events by type")).toHaveValue(
      step.type,
    );
  }
});

test("the selected tab follows the URL, and conflicting filters select All events", async ({
  page,
}) => {
  await logIn(page, "scope-url@example.test", "/events?type=tournament");
  const tabs = scopeTabs(page);
  await expect(tabs.locator("[aria-current]")).toHaveText("Tournaments");
  await expect(eventTitles(page)).toHaveText(["Summit Ridge Spring Cup"]);

  // A filter submitted from the form that equals a tab selects that tab.
  await page.getByLabel("Filter events by type").selectOption("");
  await page.getByLabel("Filter events by format").selectOption("online");
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(page).toHaveURL(/[?&]format=online/);
  await waitForAppReady(page);
  await expect(tabs.locator("[aria-current]")).toHaveText("Online");

  await gotoApp(page, "/events?school=browser-test-university");
  await expect(tabs.locator("[aria-current]")).toHaveText("My school");

  await gotoApp(page, "/events?format=online&type=tournament");
  await expect(tabs.locator("[aria-current]")).toHaveText("All events");
  await expect(eventTitles(page)).toHaveCount(0);

  // Back returns to the previous query and its tab.
  await page.goBack();
  await expect(page).toHaveURL(/\?school=browser-test-university$/);
  await waitForAppReady(page);
  await expect(tabs.locator("[aria-current]")).toHaveText("My school");
});

test("a signed-out visitor sees the tabs without My school", async ({
  page,
}) => {
  await gotoApp(page, "/events?school=browser-test-university");
  const tabs = scopeTabs(page);
  await expect(tabs.getByRole("link")).toHaveText([
    "All events",
    "Online",
    "Tournaments",
  ]);
  // A school filter alone is not a tab without a home school to match.
  await expect(tabs.locator("[aria-current]")).toHaveText("All events");

  await tabs.getByRole("link", { name: "Online" }).click();
  await expect(page).toHaveURL(
    (url) => url.pathname === "/events" && url.search === "?format=online",
  );
  await waitForAppReady(page);
  await expect(tabs.locator("[aria-current]")).toHaveText("Online");
  await expect(eventTitles(page)).toHaveText(["Online Ladder Night"]);
});
