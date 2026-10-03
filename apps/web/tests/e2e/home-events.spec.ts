import { expect, test } from "@playwright/test";
import { gotoApp, logIn } from "./fixtures/app-navigation.js";

test("the home page previews public events around campus and links to them", async ({
  page,
}) => {
  await gotoApp(page, "/");

  const section = page.getByRole("region", { name: "Events around campus" });
  await expect(section).toBeVisible();
  const event = section.getByRole("link", {
    name: /Public Browser Tournament/,
  });
  await expect(event).toHaveAttribute("href", "/events/public-browser-event");
  await expect(event).toContainText("Browser Test University");
  await expect(event).toContainText("View event");
  await expect(
    section.getByRole("link", { name: "Browse all events" }),
  ).toHaveAttribute("href", "/events");

  await event.click();
  await expect(page).toHaveURL(/\/events\/public-browser-event$/);
});

test("the sign-up prompt on the home page is for visitors only", async ({
  page,
}) => {
  const prompt = page.getByText("New here?");

  await gotoApp(page, "/");
  await expect(
    page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", {
        name: "Log in",
        exact: true,
      }),
  ).toBeVisible();
  await expect(prompt).toBeVisible();

  await logIn(page, "player@example.test", "/");
  await expect(
    page.getByRole("button", { name: "account menu" }),
  ).toBeVisible();
  await expect(prompt).toHaveCount(0);
});
