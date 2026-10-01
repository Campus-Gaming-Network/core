import { expect, test } from "@playwright/test";
import { gotoApp } from "./fixtures/app-navigation.js";

test("the home page previews recent public events and links to them", async ({
  page,
}) => {
  await gotoApp(page, "/");

  const section = page.getByRole("region", { name: "Recent events" });
  await expect(section).toBeVisible();
  const event = section.getByRole("link", {
    name: /Public Browser Tournament/,
  });
  await expect(event).toHaveAttribute("href", "/events/public-browser-event");
  await expect(event).toContainText("Browser Test University");
  await expect(
    section.getByRole("link", { name: "Browse all events" }),
  ).toHaveAttribute("href", "/events");

  await event.click();
  await expect(page).toHaveURL(/\/events\/public-browser-event$/);
});
