import { expect, test } from "@playwright/test";
import { gotoApp, logIn } from "./fixtures/app-navigation.js";

const apiURL = "http://127.0.0.1:18081";
const signedInPlayer = "player@example.test";

test.beforeEach(async ({ page, request }) => {
  const response = await request.post(`${apiURL}/__test/reset`);
  expect(response.ok()).toBe(true);
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
});

// Pages whose layout is expected to change keep to the route and the single
// level-1 heading; the rest also pin the heading text.
for (const fixture of [
  { name: "home", path: "/", heading: "Find your next game night." },
  {
    name: "event-detail",
    path: "/events/public-browser-event",
    heading: "Public Browser Tournament",
  },
  {
    name: "events",
    path: "/events",
    heading: "Browse campus gaming events",
  },
  { name: "schools", path: "/schools", heading: "Browse schools" },
  { name: "teams", path: "/teams", heading: "Find campus gaming teams" },
  { name: "login", path: "/login", heading: "Welcome back." },
  { name: "signup", path: "/signup", heading: "Join with your home school." },
  {
    name: "event-new",
    path: "/events/new",
    heading: "Create a campus gaming event",
    signedInAs: signedInPlayer,
  },
  { name: "account", path: "/account", signedInAs: signedInPlayer },
  { name: "school-detail", path: "/schools/summit-ridge-university" },
  { name: "school-detail-empty", path: "/schools/quiet-valley-college" },
  {
    name: "team-detail",
    path: "/teams/joinable-browser-team",
    heading: "Joinable Browser Team",
  },
]) {
  test(`${fixture.name} matches the approved visual system`, async ({
    page,
  }) => {
    if (fixture.signedInAs) {
      await logIn(page, fixture.signedInAs, fixture.path);
    } else {
      await gotoApp(page, fixture.path);
    }
    await expect(
      page.getByRole("heading", { name: fixture.heading, level: 1 }),
    ).toBeVisible();
    // The header's account slot stays invisible until the session lookup
    // answers, so wait for whichever state this viewer settles into.
    const navigation = page.getByRole("navigation", {
      name: "Main navigation",
    });
    await expect(
      fixture.signedInAs
        ? navigation.getByRole("button", { name: "account menu" })
        : navigation.getByRole("link", { name: "Log in", exact: true }),
    ).toBeVisible();
    if (fixture.signedInAs) {
      // The trigger's avatar is a drawn picture over its initials, so wait for
      // the picture rather than capture whichever has painted.
      await expect
        .poll(() =>
          page
            .locator(".site-header .avatar img")
            .evaluate((image: HTMLImageElement) => image.naturalWidth),
        )
        .toBeGreaterThan(0);
    }
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await expect(page).toHaveScreenshot(`${fixture.name}.png`, {
      animations: "disabled",
      caret: "hide",
      fullPage: true,
      maxDiffPixelRatio: 0.001,
      scale: "css",
    });
  });
}
