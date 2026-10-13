import { expect, test } from "@playwright/test";
import { gotoApp } from "./fixtures/app-navigation.js";

test("profile links show their site's icon, or a chain link for other sites", async ({
  page,
}) => {
  await gotoApp(page, "/users/linked-player");

  const region = page.getByRole("region", { name: "Links" });
  const links = region.getByRole("link");
  await expect(links).toHaveText(["Channel", "Posts", "Stream", "Blog"]);
  expect(
    await links.evaluateAll((elements) =>
      elements.map((element) =>
        [...element.querySelectorAll("svg")].map((icon) => ({
          site: icon.getAttribute("data-site"),
          hidden: icon.getAttribute("aria-hidden"),
        })),
      ),
    ),
  ).toEqual(
    ["youtube", "x", "twitch", "link"].map((site) => [
      { site, hidden: "true" },
    ]),
  );

  // A Discord username has no page to link to, so it is text with the mark.
  const discord = region.getByText("Discord: player.one");
  await expect(discord).toBeVisible();
  await expect(discord.locator('svg[data-site="discord"]')).toHaveAttribute(
    "aria-hidden",
    "true",
  );
});
