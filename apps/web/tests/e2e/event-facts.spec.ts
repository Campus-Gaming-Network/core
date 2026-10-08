import { expect, test, type Locator } from "@playwright/test";
import { gotoApp, logIn, waitForAppReady } from "./fixtures/app-navigation.js";

const apiURL = "http://127.0.0.1:18081";

test.beforeEach(async ({ request }) => {
  const response = await request.post(`${apiURL}/__test/reset`);
  expect(response.ok()).toBe(true);
});

test("format, type, audience, and cost each have their own icon and color", async ({
  page,
}) => {
  await logIn(page, "event-facts@example.test", "/events/new");
  await page.getByLabel("Title").fill("Distinct Facts LAN");
  await page.getByLabel("Starts at").fill("2037-08-15T13:00");
  await page.getByLabel("Ends at").fill("2037-08-15T16:00");
  await page.getByLabel("Games").selectOption("game-e2e");
  await page.getByLabel("Event type").selectOption("lan");
  await page.getByLabel("Who it's for").selectOption("campus");
  await page.getByRole("radio", { name: "Free" }).check();
  await page.getByRole("button", { name: "Create event" }).click();
  await expect(page).toHaveURL(/\?event=created$/);
  await waitForAppReady(page);

  const facts = [
    { kind: "format", label: "In person" },
    { kind: "type", label: "LAN" },
    { kind: "audience", label: "Host campus only" },
    { kind: "cost", label: "Free" },
  ];
  const expectDistinctFacts = async (pills: Locator) => {
    await expect(pills).toHaveText(facts.map((fact) => fact.label));
    const looks = await pills.evaluateAll((elements) =>
      elements.map((element) => ({
        kind: element.className.replace("event-pill event-pill--", ""),
        icons: element.querySelectorAll("svg").length,
        color: getComputedStyle(element).backgroundColor,
      })),
    );
    expect(looks.map(({ kind, icons }) => ({ kind, icons }))).toEqual(
      facts.map(({ kind }) => ({ kind, icons: 1 })),
    );
    expect(new Set(looks.map((look) => look.color)).size).toBe(facts.length);
  };

  await gotoApp(page, "/events");
  const card = page.getByRole("link", { name: /Distinct Facts LAN/ });
  await expectDistinctFacts(card.locator(".event-pill"));

  await card.click();
  await expect(page).toHaveURL(/\/events\/distinct-facts-lan-[^?]+$/);
  await waitForAppReady(page);
  await expectDistinctFacts(
    page.locator(".event-detail-header .event-pill:has(svg)"),
  );
});
