import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const eventTitle = "Midnight Strategy Session";
const managedTeamSlug = "long-beach-legends-abc123";

test("signup and resend verification use their server actions", async ({
  page
}) => {
  await page.goto("/signup?school_id=school-csulb");
  await page.getByLabel("Name").fill("New Campus Player");
  await page.getByLabel("Email").fill("new-player@example.test");
  await page.getByLabel("Password").fill("NewPassword123!");
  await page
    .getByRole("checkbox", { name: "I confirm I am 18 or older." })
    .check();
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(
    page.getByText(
      "Account created. Check your email for the verification link before logging in."
    )
  ).toBeVisible();
  await expectAccessible(page);
  await expectNoHorizontalOverflow(page);

  await page.goto("/auth/verify-email");
  await page.getByLabel("Email").fill("new-player@example.test");
  await page.getByRole("button", { name: "Resend verification" }).click();

  await expect(
    page.getByText(
      "If that account needs verification, another email is on the way."
    )
  ).toBeVisible();
  await expectAccessible(page);
  await expectNoHorizontalOverflow(page);
});

test("event server actions create, toggle interest, and cancel", async ({
  page
}) => {
  await logIn(page, "player@example.test", "/events/new");
  await expect(page).toHaveURL(/\/events\/new$/);

  await page.getByLabel("Title").fill("Campus Fall Brawl");
  await page
    .getByLabel("Description")
    .fill("An evening tournament for campus players.");
  await page.getByLabel("Starts at").fill("2037-03-10T02:00:00Z");
  await page.getByLabel("Ends at").fill("2037-03-10T05:00:00Z");
  await page.getByLabel("Location name").fill("Student Union Arena");
  await page.getByLabel("Games").selectOption("game-valorant");
  await page.getByLabel("Capacity").fill("24");
  await page
    .getByRole("checkbox", {
      name: "This event has off-site payment instructions."
    })
    .check();
  await page
    .getByLabel("Payment note")
    .fill("Register with the campus esports desk.");
  await page
    .getByLabel("Payment URL")
    .fill("https://tickets.example.test/fall-brawl");
  await expectAccessible(page);
  await page.getByRole("button", { name: "Create event" }).click();

  await expect(page).toHaveURL(
    /\/events\/campus-fall-brawl-[^?]+\?event=created$/
  );
  await expect(
    page.getByRole("heading", { name: "Campus Fall Brawl", level: 1 })
  ).toBeVisible();
  await expect(page.getByText("Event created.")).toBeVisible();
  await expect(page.getByText("0 / 24")).toBeVisible();
  await expect(
    page.getByText("Register with the campus esports desk.")
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Payment link" })).toHaveAttribute(
    "href",
    "https://tickets.example.test/fall-brawl"
  );

  await page.getByRole("button", { name: "I'm interested" }).click();
  await expect(page).toHaveURL(/\?event=interest-added$/);
  await expect(page.getByText("Marked as interested.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Remove interested" })
  ).toBeVisible();

  await page.getByRole("button", { name: "Remove interested" }).click();
  await expect(page).toHaveURL(/\?event=interest-removed$/);
  await expect(
    page.getByText("Removed from interested events.")
  ).toBeVisible();

  await page.getByRole("button", { name: "Cancel event" }).click();
  await expect(page).toHaveURL(/\/events\?event=cancelled$/);
  await expect(page.getByText("Event cancelled.")).toBeVisible();
  await expectAccessible(page);
  await expectNoHorizontalOverflow(page);
});

test("event validation returns accessible field errors before calling the API", async ({
  page
}) => {
  await logIn(page, "player@example.test", "/events/new");
  await page.getByLabel("Title").fill("Invalid schedule example");
  await page.getByLabel("Starts at").fill("2037-03-10T05:00:00Z");
  await page.getByLabel("Ends at").fill("2037-03-10T02:00:00Z");
  await page.getByLabel("Games").selectOption("game-valorant");
  await page.getByRole("button", { name: "Create event" }).click();

  await expect(page).toHaveURL(/\/events\/new$/);
  await expect(page.getByText("End time must be after start time.")).toBeVisible();
  await expect(page.getByLabel("Ends at")).toHaveAttribute(
    "aria-invalid",
    "true"
  );
  await expect(page.getByLabel("Ends at")).toHaveAttribute(
    "aria-describedby",
    "ends_at-error"
  );
  await page.mouse.move(0, 0);
  await expectAccessible(page);
});

test("team server actions join, promote a captain, and transfer ownership", async ({
  context,
  page
}) => {
  await logIn(page, "player@example.test", `/teams/${managedTeamSlug}`);
  await expect(page).toHaveURL(new RegExp(`/teams/${managedTeamSlug}$`));
  await page.getByLabel("Team password").fill("TeamPass123!");
  await page.getByRole("button", { name: "Join team" }).click();

  await expect(page).toHaveURL(/\?team=joined$/);
  await expect(page.getByText("You joined the team.")).toBeVisible();
  await expect(page.getByText("Your role: Member.")).toBeVisible();

  await context.clearCookies();
  await logIn(page, "owner@example.test", `/teams/${managedTeamSlug}`);
  await expect(page.getByText("Your role: Owner.")).toBeVisible();
  await page.getByRole("button", { name: "Make captain" }).click();

  await expect(page).toHaveURL(/\?team=captain-updated$/);
  await expect(page.getByText("Captain role updated.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Remove captain" })
  ).toBeVisible();

  await page.getByRole("button", { name: "Transfer ownership" }).click();
  await expect(page).toHaveURL(/\?team=ownership-transferred$/);
  await expect(page.getByText("Ownership transferred.")).toBeVisible();
  await expect(page.getByText("Your role: Member.")).toBeVisible();
  await expectAccessible(page);
  await expectNoHorizontalOverflow(page);
});

test("private unlock survives login and RSVP choices keep interest and capacity separate", async ({
  context,
  page
}, testInfo) => {
  const eventSlug = `private-scrim-${testInfo.project.name.startsWith("mobile") ? "mobile-" : "desktop-"}abc123`;
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
  await expect(page.getByText(/Current RSVP:/)).toContainText("Not set");
  await expect(eventDetailValue(page, "Capacity")).toHaveText("0 / 10");
  await expect(eventDetailValue(page, "Interested")).toHaveText("0");

  await page.getByRole("button", { name: "I'm interested" }).click();

  await expect(page).toHaveURL(
    new RegExp(`/events/${eventSlug}\\?event=interest-added$`)
  );
  await expect(page.getByText("Marked as interested.")).toBeVisible();
  await expect(page.getByText(/Current RSVP:/)).toContainText("Not set");
  await expect(eventDetailValue(page, "Capacity")).toHaveText("0 / 10");
  await expect(eventDetailValue(page, "Interested")).toHaveText("1");

  await page.getByRole("button", { name: "Maybe", exact: true }).click();

  await expect(page).toHaveURL(
    new RegExp(`/events/${eventSlug}\\?event=rsvp-updated$`)
  );
  await expect(page.getByText("RSVP saved.")).toBeVisible();
  await expect(page.getByText(/Current RSVP:/)).toContainText("Maybe");
  await expect(eventDetailValue(page, "Capacity")).toHaveText("0 / 10");
  await expect(eventDetailValue(page, "Interested")).toHaveText("1");

  await page.getByRole("button", { name: "Yes", exact: true }).click();

  await expect(page).toHaveURL(
    new RegExp(`/events/${eventSlug}\\?event=rsvp-updated$`)
  );
  await expect(page.getByText("RSVP saved.")).toBeVisible();
  await expect(page.getByText(/Current RSVP:/)).toContainText("Yes");
  await expect(eventDetailValue(page, "Capacity")).toHaveText("1 / 10");
  await expect(eventDetailValue(page, "Interested")).toHaveText("1");
  await expect(
    page.getByRole("button", { name: "Remove interested" })
  ).toBeVisible();

  await page.getByRole("button", { name: "No", exact: true }).click();

  await expect(page).toHaveURL(
    new RegExp(`/events/${eventSlug}\\?event=rsvp-updated$`)
  );
  await expect(page.getByText(/Current RSVP:/)).toContainText("No");
  await expect(eventDetailValue(page, "Capacity")).toHaveText("0 / 10");
  await expect(eventDetailValue(page, "Interested")).toHaveText("1");
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

function eventDetailValue(page: Page, label: string) {
  return page
    .locator(".detail-row", { has: page.getByText(label, { exact: true }) })
    .locator("strong");
}

async function logIn(page: Page, email: string, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("Password12345!");
  await page.getByRole("button", { name: "Log in" }).click();
}
