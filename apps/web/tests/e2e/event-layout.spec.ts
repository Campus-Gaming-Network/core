import { expect, test } from "@playwright/test";
import { gotoApp } from "./fixtures/app-navigation.js";

const apiURL = "http://127.0.0.1:18081";

test.beforeEach(async ({ request }) => {
  const response = await request.post(`${apiURL}/__test/reset`);
  expect(response.ok()).toBe(true);
});

test("a logged-out viewer finds RSVP first in the sidebar and event details after the description", async ({
  page,
}) => {
  await gotoApp(page, "/events/public-browser-event");

  await expect(
    page.locator("main").getByRole("heading", { level: 2 }),
  ).toHaveText([
    "About this event",
    "Event details",
    "Organizers",
    "RSVP",
    "When and where",
    "Share",
  ]);
  await expect(
    page
      .getByRole("complementary", { name: "RSVP and event info" })
      .getByRole("link", { name: "Log in to RSVP" }),
  ).toBeVisible();
});

test("RSVP is the first card when the event page stacks on phones", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  await gotoApp(page, "/events/public-browser-event");

  // DOM order is About, Event details, Organizers, then the sidebar's RSVP,
  // When and where, and Share. Stacked on a phone, the sidebar comes first.
  const [about, details, organizers, rsvp, whenAndWhere, share] = await page
    .locator("main h2")
    .evaluateAll((headings) =>
      headings.map((heading) => heading.getBoundingClientRect().top),
    );
  const stacked = [rsvp, whenAndWhere, share, about, details, organizers];
  expect(
    stacked.every((top, index) => index === 0 || top > stacked[index - 1]),
    `RSVP, When and where, Share, About, Event details, Organizers must stack top to bottom, got ${stacked.join(", ")}`,
  ).toBe(true);
});
