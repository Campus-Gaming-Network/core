import { expect, test } from "@playwright/test";
import { gotoApp } from "./fixtures/app-navigation.js";

test("the home page advertises popular schools, most popular first", async ({
  page,
}) => {
  await gotoApp(page, "/");

  const section = page.getByRole("region", { name: "Popular campuses" });
  await expect(section).toBeVisible();
  const cards = section.getByRole("link", { name: /University/ });
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText("Follow Browser University");
  await expect(cards.nth(1)).toContainText("Browser Test University");
  await expect(cards.nth(0)).toHaveAttribute(
    "href",
    "/schools/follow-browser-university",
  );
});
