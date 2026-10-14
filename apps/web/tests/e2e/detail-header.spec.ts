import { expect, test } from "@playwright/test";
import { gotoApp } from "./fixtures/app-navigation.js";

const apiURL = "http://127.0.0.1:18081";

test.beforeEach(async ({ request }) => {
  const response = await request.post(`${apiURL}/__test/reset`);
  expect(response.ok()).toBe(true);
});

// Each detail page opens with the shared header: a breadcrumb trail ending in
// the page itself, one h1 that names it, and a key information list.
for (const fixture of [
  {
    path: "/events/public-browser-event",
    parent: "Events",
    current: "Public Browser Tournament",
    facts: [
      "Games",
      "Strategy Arena",
      "Attending",
      "0 of 24",
      "Interested",
      "2",
    ],
  },
  {
    path: "/schools/summit-ridge-university",
    parent: "Schools",
    current: "Summit Ridge University",
    facts: ["Location", "Denver, CO", "Campus type", "Main campus"],
  },
  {
    path: "/teams/joinable-browser-team",
    parent: "Teams",
    current: "Joinable Browser Team",
    facts: [
      "Games",
      "Strategy Arena",
      "School",
      "Browser Test University",
      "Members",
      "2",
    ],
  },
]) {
  test(`${fixture.path} opens with breadcrumbs, one heading, and key information`, async ({
    page,
  }) => {
    await gotoApp(page, fixture.path);
    const breadcrumbs = page.getByRole("navigation", { name: "Breadcrumb" });

    await expect(breadcrumbs.getByRole("listitem")).toHaveText([
      fixture.parent,
      fixture.current,
    ]);
    await expect(breadcrumbs.getByRole("link")).toHaveText([fixture.parent]);
    await expect(breadcrumbs.locator('[aria-current="page"]')).toHaveText(
      fixture.current,
    );
    await expect(page.getByRole("heading", { level: 1 })).toHaveText([
      fixture.current,
    ]);
    await expect(
      page.getByRole("region", { name: "Key information" }).locator("dt, dd"),
    ).toHaveText(fixture.facts);
  });
}
