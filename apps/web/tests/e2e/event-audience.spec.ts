import { expect, test } from "@playwright/test";
import { gotoApp, logIn, waitForAppReady } from "./fixtures/app-navigation.js";

const apiURL = "http://127.0.0.1:18081";

test.beforeEach(async ({ request }) => {
  const response = await request.post(`${apiURL}/__test/reset`);
  expect(response.ok()).toBe(true);
});

test("an event needs an audience, shows it, and can be filtered by it", async ({
  page,
}) => {
  await logIn(page, "audience@example.test", "/events/new");
  await page.getByLabel("Title").fill("Campus Only Scrim");
  await page.getByLabel("Starts at").fill("2037-08-15T13:00");
  await page.getByLabel("Ends at").fill("2037-08-15T16:00");
  await page.getByLabel("Games").selectOption("game-e2e");
  await page.getByLabel("Event type").selectOption("game_night");
  // The browser stops an empty required field itself. Turn that off to reach
  // the server's answer, as a client without native validation would.
  await page.locator("form.event-form").evaluate((form: HTMLFormElement) => {
    form.noValidate = true;
  });
  await page.getByRole("button", { name: "Create event" }).click();

  const audience = page.getByLabel("Who it's for");
  await page
    .getByRole("alert")
    .getByRole("link", { name: "Choose who this event is for." })
    .click();
  await expect(audience).toBeFocused();
  await expect(audience).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#event-audience-error")).toHaveText(
    "Choose who this event is for.",
  );

  await audience.selectOption("campus");
  await page.getByRole("button", { name: "Create event" }).click();
  await expect(page).toHaveURL(
    /\/events\/campus-only-scrim-[^?]+\?event=created$/,
  );
  await waitForAppReady(page);
  await expect(page.locator(".event-pill-list .event-pill")).toHaveText([
    "Public",
    "In person",
    "Game night",
    "Host campus only",
  ]);

  await gotoApp(page, "/events/new");
  await page.getByLabel("Title").fill("Everyone Welcome Scrim");
  await page.getByLabel("Starts at").fill("2037-08-16T13:00");
  await page.getByLabel("Ends at").fill("2037-08-16T16:00");
  await page.getByLabel("Games").selectOption("game-e2e");
  await page.getByLabel("Event type").selectOption("game_night");
  await page.getByLabel("Who it's for").selectOption("open");
  await page.getByRole("button", { name: "Create event" }).click();
  await expect(page).toHaveURL(
    /\/events\/everyone-welcome-scrim-[^?]+\?event=created$/,
  );
  await waitForAppReady(page);

  await gotoApp(page, "/events");
  const campusCard = page.getByRole("link", { name: /Campus Only Scrim/ });
  const openCard = page.getByRole("link", { name: /Everyone Welcome Scrim/ });
  await expect(campusCard.locator(".event-pill--audience")).toHaveText(
    "Host campus only",
  );
  await expect(openCard.locator(".event-pill--audience")).toHaveText(
    "Open to everyone",
  );

  await page.getByLabel("Filter events by audience").selectOption("open");
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(page).toHaveURL(/[?&]audience=open/);
  await waitForAppReady(page);
  await expect(openCard).toBeVisible();
  await expect(campusCard).toHaveCount(0);
  await expect(page.getByLabel("Filter events by audience")).toHaveValue(
    "open",
  );
});

test("an event with no audience shows no audience label", async ({ page }) => {
  await gotoApp(page, "/events/public-browser-event");
  await expect(page.locator(".event-pill-list .event-pill")).toHaveText([
    "Public",
    "In person",
  ]);

  await gotoApp(page, "/");
  await expect(
    page.getByRole("link", { name: /Public Browser Tournament/ }),
  ).not.toContainText(
    /Open to everyone|College students|Host campus only|Members only/,
  );
});
