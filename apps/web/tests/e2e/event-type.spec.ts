import { expect, test } from "@playwright/test";
import { gotoApp, logIn, waitForAppReady } from "./fixtures/app-navigation.js";

const apiURL = "http://127.0.0.1:18081";

test.beforeEach(async ({ request }) => {
  const response = await request.post(`${apiURL}/__test/reset`);
  expect(response.ok()).toBe(true);
});

test("an event needs a type, shows it, and can be filtered by it", async ({
  page,
}) => {
  await logIn(page, "event-type@example.test", "/events/new");
  await page.getByLabel("Title").fill("Fall Campus LAN");
  await page.getByLabel("Starts at").fill("2037-08-15T13:00");
  await page.getByLabel("Ends at").fill("2037-08-15T16:00");
  await page.getByLabel("Games").selectOption("game-e2e");
  await page.getByLabel("Who it's for").selectOption("open");
  // The browser stops an empty required field itself. Turn that off to reach
  // the server's answer, as a client without native validation would.
  await page.locator("form.event-form").evaluate((form: HTMLFormElement) => {
    form.noValidate = true;
  });
  await page.getByRole("button", { name: "Create event" }).click();

  const type = page.getByLabel("Event type");
  await page
    .getByRole("alert")
    .getByRole("link", { name: "Choose an event type." })
    .click();
  await expect(type).toBeFocused();
  await expect(type).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#event-event-type-error")).toHaveText(
    "Choose an event type.",
  );

  await type.selectOption("lan");
  await page.getByRole("button", { name: "Create event" }).click();
  await expect(page).toHaveURL(
    /\/events\/fall-campus-lan-[^?]+\?event=created$/,
  );
  await waitForAppReady(page);
  await expect(page.locator(".event-pill-list .event-pill")).toHaveText([
    "Public",
    "In person",
    "LAN",
    "Open to everyone",
  ]);

  await gotoApp(page, "/events/new");
  await page.getByLabel("Title").fill("Weekly Couch Co-op");
  await page.getByLabel("Starts at").fill("2037-08-16T13:00");
  await page.getByLabel("Ends at").fill("2037-08-16T16:00");
  await page.getByLabel("Games").selectOption("game-e2e");
  await page.getByLabel("Event type").selectOption("game_night");
  await page.getByLabel("Who it's for").selectOption("open");
  await page.getByRole("button", { name: "Create event" }).click();
  await expect(page).toHaveURL(
    /\/events\/weekly-couch-co-op-[^?]+\?event=created$/,
  );
  await waitForAppReady(page);

  await gotoApp(page, "/events");
  const lanCard = page.getByRole("link", { name: /Fall Campus LAN/ });
  const gameNightCard = page.getByRole("link", { name: /Weekly Couch Co-op/ });
  await expect(lanCard.locator(".event-pill--type")).toHaveText("LAN");
  await expect(gameNightCard.locator(".event-pill--type")).toHaveText(
    "Game night",
  );

  await page.getByLabel("Filter events by type").selectOption("lan");
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(page).toHaveURL(/[?&]type=lan/);
  await waitForAppReady(page);
  await expect(lanCard).toBeVisible();
  await expect(gameNightCard).toHaveCount(0);
  await expect(page.getByLabel("Filter events by type")).toHaveValue("lan");
});

test("an event with no type shows no type label", async ({ page }) => {
  await gotoApp(page, "/events/public-browser-event");
  await expect(page.locator(".event-pill-list .event-pill")).toHaveText([
    "Public",
    "In person",
  ]);

  await gotoApp(page, "/");
  await expect(
    page.getByRole("link", { name: /Public Browser Tournament/ }),
  ).not.toContainText(
    /Game night|LAN|Watch party|Tryout|Meeting|Workshop|Other/,
  );
});
