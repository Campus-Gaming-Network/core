import { expect, test } from "@playwright/test";
import { gotoApp, logIn, waitForAppReady } from "./fixtures/app-navigation.js";

const apiURL = "http://127.0.0.1:18081";

test.beforeEach(async ({ request }) => {
  const response = await request.post(`${apiURL}/__test/reset`);
  expect(response.ok()).toBe(true);
});

test("free events say so and can be filtered; paid events keep their note", async ({
  page,
}) => {
  await logIn(page, "event-cost@example.test", "/events/new");
  for (const event of [
    { title: "Free Play Friday", slug: "free-play-friday", cost: "Free" },
    { title: "Ticketed Finals", slug: "ticketed-finals", cost: "Paid" },
    // Left at the default, as an event migrated from the old unpaid flag is.
    { title: "Cost Unsaid Meetup", slug: "cost-unsaid-meetup" },
  ]) {
    await gotoApp(page, "/events/new");
    await page.getByLabel("Title").fill(event.title);
    await page.getByLabel("Starts at").fill("2037-08-15T13:00");
    await page.getByLabel("Ends at").fill("2037-08-15T16:00");
    await page.getByLabel("Games").selectOption("game-e2e");
    await page.getByLabel("Event type").selectOption("game_night");
    await page.getByLabel("Who it's for").selectOption("open");
    if (event.cost) {
      await page.getByRole("radio", { name: event.cost }).check();
    }
    if (event.cost === "Paid") {
      await page.getByLabel("Payment note").fill("Ten dollars at the door.");
    }
    await page.getByRole("button", { name: "Create event" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/events/${event.slug}-[^?]+\\?event=created$`),
    );
    await waitForAppReady(page);

    await expect(page.locator(".event-pill-list .event-pill")).toHaveText([
      "Public",
      "In person",
      "Game night",
      "Open to everyone",
      ...(event.cost === "Free" ? ["Free"] : []),
    ]);
    await expect(page.getByText("Ten dollars at the door.")).toHaveCount(
      event.cost === "Paid" ? 1 : 0,
    );
  }

  await gotoApp(page, "/events");
  const freeCard = page.getByRole("link", { name: /Free Play Friday/ });
  const paidCard = page.getByRole("link", { name: /Ticketed Finals/ });
  const unsaidCard = page.getByRole("link", { name: /Cost Unsaid Meetup/ });
  await expect(
    freeCard.getByText("Game night · Open to everyone · Free"),
  ).toBeVisible();
  await expect(
    paidCard.getByText("Game night · Open to everyone", { exact: true }),
  ).toBeVisible();
  await expect(
    unsaidCard.getByText("Game night · Open to everyone", { exact: true }),
  ).toBeVisible();

  await page.getByLabel("Filter events by cost").selectOption("free");
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(page).toHaveURL(/[?&]cost=free/);
  await waitForAppReady(page);
  await expect(freeCard).toBeVisible();
  await expect(paidCard).toHaveCount(0);
  await expect(unsaidCard).toHaveCount(0);
  await expect(page.getByLabel("Filter events by cost")).toHaveValue("free");
});
