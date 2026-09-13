import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const apiURL = "http://127.0.0.1:18081";

test.beforeEach(async ({ request }) => {
  const response = await request.post(`${apiURL}/__test/reset`);
  expect(response.ok()).toBe(true);
});

test("keyboard users can skip navigation and receive route-change focus", async ({
  page
}) => {
  await page.goto("/");

  const skipLink = page.getByRole("link", { name: "Skip to main content" });
  await page.keyboard.press("Tab");
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();

  await page.waitForFunction(() => "__TSR_ROUTER__" in window);
  await page.getByRole("link", { name: "Schools", exact: true }).click();
  await expect(page).toHaveURL(/\/schools$/);
  const heading = page.getByRole("heading", {
    name: "Browse schools",
    level: 1
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
  "/users/reportable-player",
  "/support"
]) {
  test(`${path} keeps landmarks, headings, and viewport bounds`, async ({
    page
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    const response = await page.goto(path);
    expect(response?.status(), `${path} must render successfully`).toBe(200);
    await expect(
      page.getByRole("navigation", { name: "Main navigation" })
    ).toBeVisible();
    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.locator("main h1")).toHaveCount(1);
    await expect(page.locator("main h1")).toBeVisible();

    const overflow = await horizontalOverflow(page);
    expect(
      overflow,
      `${path} must not overflow the ${page.viewportSize()?.width ?? "current"}px viewport`
    ).toBeLessThanOrEqual(1);

    await expectAccessible(page);
    expect(pageErrors).toEqual([]);
  });
}

test("enhanced validation feedback identifies the invalid event field", async ({
  page
}) => {
  await logIn(page, "/events/new");
  await page.getByLabel("Title").fill("Accessible validation event");
  await page.getByLabel("Starts at").fill("2037-08-15T16:00");
  await page.getByLabel("Ends at").fill("2037-08-15T13:00");
  await page.getByLabel("Games").selectOption("game-e2e");
  await page.getByRole("button", { name: "Create event" }).click();

  const endTime = page.getByLabel("Ends at");
  await expect(page.getByRole("alert")).toContainText(
    "Check the highlighted fields"
  );
  await expect(endTime).toHaveAttribute("aria-invalid", "true");
  await expect(endTime).toHaveAttribute(
    "aria-describedby",
    "event-ends-at-error"
  );
  await expect(page.locator("#event-ends-at-error")).toContainText(
    "End time must be after start time"
  );
  await expectAccessible(page);
});

test("event report API failures use an assertive error region", async ({
  page
}) => {
  await logIn(page, "/events/public-browser-event");
  await page.getByLabel("Reason").fill("Trigger report failure");
  await page.getByRole("button", { name: "Submit report" }).click();

  await expect(page.getByRole("alert")).toContainText(
    "We could not submit that report"
  );
  await expectAccessible(page);
});

test("owner roster controls include the affected member name", async ({
  page
}) => {
  await logIn(page, "/teams/new");
  await page.getByLabel("Team name").fill("Accessible Owner Team");
  await page.getByRole("checkbox", { name: "Strategy Arena" }).check();
  await page.getByLabel("Join password").fill("BrowserTeamPass123!");
  await page.getByRole("button", { name: "Create team" }).click();

  await expect(
    page.getByRole("button", { name: "Make captain Browser Teammate" })
  ).toBeVisible();
  await expectAccessible(page);
});

test("long user content reflows at a 320px viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const response = await page.goto("/events/long-content-event");
  expect(response?.status()).toBe(200);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  await expectAccessible(page);
});

for (const path of ["/account", "/events/new", "/teams/new"]) {
  test(`${path} keeps accessible authenticated forms and layouts`, async ({
    page
  }) => {
    await page.goto("/login?next=/account");
    await page.getByLabel("Email").fill("player@example.test");
    await page.getByLabel("Password").fill("Password12345!");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/account$/);

    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    const response = await page.goto(path);
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
        summary: node.failureSummary
      }))
    }))
  ).toEqual([]);
}

async function logIn(page: Page, next: string): Promise<void> {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill("accessibility@example.test");
  await page.getByLabel("Password").fill("E2EPassword123!");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(
    new RegExp(`${next.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`)
  );
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
}
