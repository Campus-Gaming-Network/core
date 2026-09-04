import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const eventSlug = "private-scrim-abc123";
const eventTitle = "Midnight Strategy Session";

test("private event unlock cookie survives login and authorizes RSVP", async ({
  context,
  page
}) => {
  await page.goto(`/events/${eventSlug}`);

  await expect(
    page.getByRole("heading", { name: "This event is private." })
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText(eventTitle);
  await expectAccessible(page);

  await page.getByLabel("Event password").fill("EventPass123!");
  await page.getByRole("button", { name: "Unlock event" }).click();

  await expect(page).toHaveURL(
    new RegExp(`/events/${eventSlug}\\?event=unlocked$`)
  );
  await expect(
    page.getByRole("heading", { name: eventTitle, level: 1 })
  ).toBeVisible();
  await expect
    .poll(async () => {
      const cookie = (await context.cookies()).find(
        ({ name }) => name === `cgn_event_unlock_${eventSlug}`
      );

      return cookie
        ? {
            httpOnly: cookie.httpOnly,
            path: cookie.path,
            sameSite: cookie.sameSite
          }
        : null;
    })
    .toEqual({ httpOnly: true, path: "/", sameSite: "Lax" });

  await page
    .getByRole("link", { name: "Log in to RSVP or mark interested" })
    .click();
  await page.getByLabel("Email").fill("player@example.test");
  await page.getByLabel("Password").fill("Password12345!");
  await page.getByRole("button", { name: "Log in" }).click();

  await expect(page).toHaveURL(new RegExp(`/events/${eventSlug}$`));
  await page.getByRole("button", { name: "Yes", exact: true }).click();

  await expect(page).toHaveURL(
    new RegExp(`/events/${eventSlug}\\?event=rsvp-updated$`)
  );
  await expect(page.getByText("RSVP saved.")).toBeVisible();
  await expect(page.getByText(/Current RSVP:/)).toContainText("Yes");
  await expectAccessible(page);
  await expectNoHorizontalOverflow(page);
});

test("account dashboard composes RSVP, followed-school, and team activity", async ({
  page
}) => {
  await page.goto("/login?next=/account");
  await page.getByLabel("Email").fill("player@example.test");
  await page.getByLabel("Password").fill("Password12345!");
  await page.getByRole("button", { name: "Log in" }).click();

  await expect(page).toHaveURL(/\/account$/);
  await expect(
    page.getByRole("heading", { name: "Upcoming RSVPs" })
  ).toBeVisible();
  await expect(page.getByText("Rocket League Finals")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Followed-school events" })
  ).toBeVisible();
  await expect(page.getByText("Campus Open Play")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Team activity" })
  ).toBeVisible();
  await expect(page.getByText("UCI Valorant")).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: /^California State University, Long Beach/
    })
  ).toBeVisible();
  await expectAccessible(page);
  await expectNoHorizontalOverflow(page);
});

async function expectAccessible(page: Page) {
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

async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth
      )
    )
    .toBe(true);
}
