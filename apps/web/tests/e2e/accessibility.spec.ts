import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { gotoApp, logIn } from "./fixtures/app-navigation.js";

const apiURL = "http://127.0.0.1:18081";

test.beforeEach(async ({ request }) => {
  const response = await request.post(`${apiURL}/__test/reset`);
  expect(response.ok()).toBe(true);
});

test("keyboard users can skip navigation and receive route-change focus", async ({
  page,
}) => {
  await gotoApp(page, "/");

  const skipLink = page.getByRole("link", { name: "Skip to main content" });
  await page.keyboard.press("Tab");
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();

  await page.getByRole("link", { name: "Schools", exact: true }).click();
  await expect(page).toHaveURL(/\/schools$/);
  const heading = page.getByRole("heading", {
    name: "Browse schools",
    level: 1,
  });
  await expect(heading).toBeFocused();
  await expect(heading).toBeVisible();
});

for (const path of [
  "/",
  "/signup?q=Browser",
  "/events",
  "/events/public-browser-event",
  "/events/private-browser-event",
  "/teams",
  "/teams/joinable-browser-team",
  "/schools/follow-browser-university",
  "/schools/summit-ridge-university",
  "/schools/quiet-valley-college",
  "/users/reportable-player",
  "/support",
]) {
  test(`${path} keeps landmarks, headings, and viewport bounds`, async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    const response = await gotoApp(page, path);
    expect(response?.status(), `${path} must render successfully`).toBe(200);
    await expect(
      page.getByRole("navigation", { name: "Main navigation" }),
    ).toBeVisible();
    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.locator("main h1")).toHaveCount(1);
    await expect(page.locator("main h1")).toBeVisible();

    const overflow = await horizontalOverflow(page);
    expect(
      overflow,
      `${path} must not overflow the ${page.viewportSize()?.width ?? "current"}px viewport`,
    ).toBeLessThanOrEqual(1);

    await expectAccessible(page);
    expect(pageErrors).toEqual([]);
  });
}

// Signed-in viewers also see who is going, who is at a school, and who is on a
// team, on the page and on a full page of its own.
for (const path of [
  "/events/public-browser-event",
  "/events/public-browser-event/people",
  "/events/public-browser-event/people?response=maybe",
  "/events/quiet-browser-event/people",
  "/schools/browser-test-university",
  "/schools/browser-test-university/people",
  "/schools/quiet-valley-college/people",
  "/teams/joinable-browser-team",
  "/teams/joinable-browser-team/people",
  "/teams/empty-browser-team/people",
]) {
  test(`${path} keeps landmarks, headings, and viewport bounds when signed in`, async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await logIn(page, "player@example.test", "/account");
    const response = await gotoApp(page, path);
    expect(response?.status(), `${path} must render successfully`).toBe(200);
    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.locator("main h1")).toHaveCount(1);
    await expect(page.locator("main h1")).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
    await expectAccessible(page);
    expect(pageErrors).toEqual([]);
  });
}

test("enhanced validation feedback identifies the invalid event field", async ({
  page,
}) => {
  await logIn(page, "accessibility@example.test", "/events/new");
  await page.getByLabel("Title").fill("Accessible validation event");
  await page.getByLabel("Starts at").fill("2037-08-15T16:00");
  await page.getByLabel("Ends at").fill("2037-08-15T13:00");
  await page.getByLabel("Games").selectOption("game-e2e");
  await page.getByRole("button", { name: "Create event" }).click();

  const endTime = page.getByLabel("Ends at");
  await expect(page.getByRole("alert")).toContainText(
    "Check the highlighted fields",
  );
  await expect(page.getByRole("alert")).toBeFocused();
  const errorLink = page.getByRole("alert").getByRole("link", {
    name: "End time must be after start time",
  });
  await expect(errorLink).toBeVisible();
  await errorLink.click();
  await expect(endTime).toBeFocused();
  await expect(endTime).toHaveAttribute("aria-invalid", "true");
  await expect(endTime).toHaveAttribute(
    "aria-describedby",
    "event-ends-at-error",
  );
  await expect(page.locator("#event-ends-at-error")).toContainText(
    "End time must be after start time",
  );
  await expectAccessible(page);
});

test("private event validation links to the highlighted password field", async ({
  page,
}) => {
  await logIn(page, "accessibility@example.test", "/events/new");
  await page.getByLabel("Title").fill("Private validation event");
  await page.getByLabel("Starts at").fill("2037-08-15T13:00");
  await page.getByLabel("Ends at").fill("2037-08-15T16:00");
  await page.getByLabel("Games").selectOption("game-e2e");
  await page.getByRole("radio", { name: "Private" }).check();
  await page.getByRole("button", { name: "Create event" }).click();

  await expect(page.getByRole("alert")).toBeFocused();
  await page
    .getByRole("alert")
    .getByRole("link", {
      name: "Private events require a password of at least 8 characters.",
    })
    .click();
  const password = page.getByLabel("Private event password");
  await expect(password).toBeFocused();
  await expect(password).toHaveAttribute("aria-invalid", "true");
  await expect(password).toHaveAttribute(
    "aria-describedby",
    "event-private-password-error",
  );
  await expectAccessible(page);
});

test("destructive confirmation returns focus when dismissed", async ({
  page,
}) => {
  await logIn(page, "dialog-accessibility@example.test", "/account");
  await page.getByLabel("Type DELETE to confirm").fill("DELETE");
  const trigger = page.getByRole("button", { name: "Delete account" });
  await trigger.click();

  const dialog = page.getByRole("dialog", {
    name: "Permanently delete your account?",
  });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Keep account" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expectAccessible(page);
});

test("event report API failures use an assertive error region", async ({
  page,
}) => {
  await logIn(
    page,
    "accessibility@example.test",
    "/events/public-browser-event",
  );
  await page.getByText("Report this event").click();
  await page.getByLabel("Reason").fill("Trigger report failure");
  await page.getByRole("button", { name: "Submit report" }).click();

  await expect(page.getByRole("alert")).toContainText(
    "We could not submit that report",
  );
  await expectAccessible(page);
});

test("owner roster controls include the affected member name", async ({
  page,
}) => {
  await logIn(page, "accessibility@example.test", "/teams/new");
  await page.getByLabel("Team name").fill("Accessible Owner Team");
  await page.getByRole("checkbox", { name: "Strategy Arena" }).check();
  await page.getByLabel("Join password").fill("BrowserTeamPass123!");
  await page.getByRole("button", { name: "Create team" }).click();

  await expect(
    page.getByRole("button", { name: "Make captain Browser Teammate" }),
  ).toBeVisible();
  await expectAccessible(page);
});

test("long user content reflows at a 320px viewport", async ({
  page,
}, testInfo) => {
  // The test sets its own phone-sized viewport, so the desktop project would
  // only repeat it.
  test.skip(testInfo.project.name !== "mobile-chromium");
  await page.setViewportSize({ width: 320, height: 568 });
  const response = await gotoApp(page, "/events/long-content-event");
  expect(response?.status()).toBe(200);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  await expectAccessible(page);
});

const primaryJourneyPaths = [
  "/signup",
  "/login",
  "/events",
  "/events/public-browser-event",
  "/teams",
  "/teams/joinable-browser-team",
];
for (const path of [
  "/events/public-browser-event",
  "/events/public-browser-event/people",
  "/schools/browser-test-university/people",
  "/teams/joinable-browser-team/people",
]) {
  test(`${path} reflows at a 320px viewport when signed in`, async ({
    page,
  }, testInfo) => {
    // The test sets its own phone-sized viewport, so the desktop project
    // would only repeat it.
    test.skip(testInfo.project.name !== "mobile-chromium");
    await page.setViewportSize({ width: 320, height: 568 });
    await logIn(page, "player@example.test", "/account");
    const response = await gotoApp(page, path);
    expect(response?.status()).toBe(200);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
    await expectAccessible(page);
  });
}

const authenticatedJourneyPaths = [
  "/account",
  "/events/new",
  "/teams/new",
  "/events/public-browser-event",
  "/events/public-browser-event/people",
  "/schools/browser-test-university",
  "/schools/browser-test-university/people",
  "/teams/joinable-browser-team",
  "/teams/joinable-browser-team/people",
];

for (const path of primaryJourneyPaths) {
  test(`${path} reflows at a 320px viewport`, async ({ page }, testInfo) => {
    // The test sets its own phone-sized viewport, so the desktop project
    // would only repeat it.
    test.skip(testInfo.project.name !== "mobile-chromium");
    await page.setViewportSize({ width: 320, height: 568 });
    const response = await gotoApp(page, path);
    expect(response?.status()).toBe(200);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
    await expectAccessible(page);
  });
}

// Phones get 44px targets; the checkbox itself is at least 24px and its label,
// which is what a tap lands on, is 44px.
for (const path of authenticatedJourneyPaths) {
  test(`${path} keeps touch targets large enough on phones`, async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chromium");
    await logIn(page, "player@example.test", "/account");
    await gotoApp(page, path);

    const undersized = await page.evaluate(() => {
      const minimum = 44;
      const controls = document.querySelectorAll<HTMLElement>(
        "button, .button, .site-header a, .site-footer a, .section-heading a, .detail-row a, .link, .checkbox-field",
      );
      const small = [];
      for (const control of controls) {
        const box = control.getBoundingClientRect();
        if (box.height > 0 && box.height < minimum - 0.5) {
          small.push(
            `${control.tagName.toLowerCase()} "${control.textContent?.trim().slice(0, 30)}" ${Math.round(box.height)}px`,
          );
        }
      }
      for (const box of document.querySelectorAll<HTMLInputElement>(
        "input[type=checkbox], input[type=radio]",
      )) {
        const { width, height } = box.getBoundingClientRect();
        if (width < 24 || height < 24) {
          small.push(
            `${box.name} ${Math.round(width)}x${Math.round(height)}px`,
          );
        }
      }
      return small;
    });
    expect(undersized).toEqual([]);
  });
}

for (const path of ["/account", "/events/new", "/teams/new"]) {
  test(`${path} keeps accessible authenticated forms and layouts`, async ({
    page,
  }) => {
    await logIn(page, "player@example.test", "/account");

    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    const response = await gotoApp(page, path);
    expect(response?.status(), `${path} must render successfully`).toBe(200);
    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.locator("main h1")).toHaveCount(1);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
    await expectAccessible(page);
    expect(pageErrors).toEqual([]);
  });
}

async function expectAccessible(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();

  expect(
    results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      targets: violation.nodes.map((node) => ({
        selector: node.target.join(" "),
        summary: node.failureSummary,
      })),
    })),
  ).toEqual([]);
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
}
