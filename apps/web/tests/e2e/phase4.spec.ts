import { expect, test, type BrowserContext } from "@playwright/test";
import { gotoApp, logIn } from "./fixtures/app-navigation.js";

const apiURL = "http://127.0.0.1:18081";
const password = "E2EPassword123!";

test.beforeEach(async ({ request }) => {
  const response = await request.post(`${apiURL}/__test/reset`);
  expect(response.ok()).toBe(true);
});

test("login rejects control-character redirect targets", async ({ page }) => {
  const unsafeNext = new URLSearchParams({
    next: "/\t/attacker.example",
  });
  await gotoApp(page, `/login?${unsafeNext}`);
  await page.getByLabel("Email").fill("safe-redirect@example.test");
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/account$/);
});

test("public auth recovery and private account mutations work through the runtime", async ({
  context,
  page,
}, testInfo) => {
  const device = deviceName(testInfo.project.name);

  await gotoApp(page, "/signup?q=Browser");
  await expect(page.getByLabel("Search schools")).toBeVisible();
  await page.getByLabel("Name").fill("New Browser Player");
  await page.getByLabel("Email").fill(`signup-${device}@example.test`);
  await page.getByLabel("Password").fill(password);
  await page.getByLabel("Home school").selectOption("school-e2e");
  await page.getByRole("checkbox", { name: /18 or older/ }).check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(
    page.getByText("Account created. Check your email"),
  ).toBeVisible();

  await gotoApp(page, "/forgot-password");
  await page.getByLabel("Email").fill(`recovery-${device}@example.test`);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toContainText(
    "If that account exists",
  );

  await gotoApp(page, `/auth/verify-email?token=valid-verification-${device}`);
  await page.getByRole("button", { name: "Verify email" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Your email is verified",
  );

  await gotoApp(page, `/auth/reset-password?token=valid-reset-${device}`);
  await expect(page).toHaveURL(
    new RegExp(`/reset-password\\?token=valid-reset-${device}$`),
  );
  await page.getByLabel("New password").fill("UpdatedPassword123!");
  await page.getByRole("button", { name: "Reset password" }).click();
  await expect(page).toHaveURL(/\/login\?reset=complete$/);
  await expect(page.getByText("Password reset.")).toBeVisible();

  await logIn(page, `account-${device}@example.test`, "/account");
  await expect(page.getByText("Browser Dashboard RSVP")).toBeVisible();
  await page.getByLabel("Name").fill("Updated Browser Player");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page).toHaveURL(/\/account\?account=profile-updated$/);
  await expect(
    page.getByRole("heading", { name: "Updated Browser Player", level: 1 }),
  ).toBeVisible();

  await page.getByLabel("Type DELETE to confirm").fill("DELETE");
  await page.getByRole("button", { name: "Delete account" }).click();
  await page
    .getByRole("button", { name: "Permanently delete account" })
    .click();
  await expect(page).toHaveURL(/\/\?account=deleted$/);
  await expect
    .poll(async () => hasCookie(await context.cookies(), "cgn_session"))
    .toBe(false);
});

test("account social links reveal extra rows and save through the runtime", async ({
  page,
}, testInfo) => {
  const device = deviceName(testInfo.project.name);
  await logIn(page, `social-links-${device}@example.test`, "/account");

  await expect(page.getByLabel("Social link 1 label")).toBeVisible();
  await expect(page.getByLabel("Social link 2 label")).toBeHidden();

  await page.getByText("Add another link").click();
  await page.getByLabel("Social link 1 label").fill("Twitch");
  await page
    .getByLabel("Social link 1 URL")
    .fill("https://twitch.example.test/player");
  await page.getByLabel("Social link 2 label").fill("Discord");
  await page
    .getByLabel("Social link 2 URL")
    .fill("https://discord.example.test/player");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page).toHaveURL(/\/account\?account=profile-updated$/);

  await expect(page.getByLabel("Social link 3 label")).toBeVisible();
  await expect(page.getByText("Add another link")).toHaveCount(0);
  expect(
    await page.locator('input[name^="social_"]').evaluateAll((inputs) =>
      inputs.map((input) => ({
        name: input.getAttribute("name"),
        value: (input as HTMLInputElement).value,
      })),
    ),
  ).toEqual([
    { name: "social_label_0", value: "Twitch" },
    { name: "social_url_0", value: "https://twitch.example.test/player" },
    { name: "social_label_1", value: "Discord" },
    { name: "social_url_1", value: "https://discord.example.test/player" },
    { name: "social_label_2", value: "" },
    { name: "social_url_2", value: "" },
  ]);
});

test("event create, report, interest, edit, and cancellation work through the runtime", async ({
  page,
}, testInfo) => {
  const device = deviceName(testInfo.project.name);
  await logIn(page, `event-${device}@example.test`, "/events/new");

  await page.getByLabel("Title").fill("Browser Campus Tournament");
  await page
    .getByLabel("Description")
    .fill("A production-browser migration test event.");
  await page.getByLabel("Starts at").fill("2037-08-15T13:00");
  await page.getByLabel("Ends at").fill("2037-08-15T16:00");
  await page.getByLabel("Location name").fill("Browser Student Union");
  await page.getByLabel("Games").selectOption("game-e2e");
  await page.getByLabel("Capacity").fill("24");
  await page.getByRole("button", { name: "Create event" }).click();

  await expect(page).toHaveURL(
    /\/events\/browser-campus-tournament-[^?]+\?event=created$/,
  );
  await expect(
    page.getByRole("heading", { name: "Browser Campus Tournament", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("Event created.")).toBeVisible();

  await page.getByText("Report this event").click();
  await page.getByLabel("Reason").fill("Testing the private report boundary.");
  await page.getByRole("button", { name: "Submit report" }).click();
  await expect(page.getByText("Report submitted for review.")).toBeVisible();

  await page.getByRole("button", { name: "I'm interested" }).click();
  await expect(page).toHaveURL(/\?event=interest-added$/);
  await expect(page.getByText("Marked as interested.")).toBeVisible();

  await page.getByRole("link", { name: "Edit event" }).click();
  await page.getByLabel("Title").fill("Updated Browser Tournament");
  await page.getByRole("button", { name: "Save event" }).click();
  await expect(page).toHaveURL(/\?event=updated$/);
  await expect(
    page.getByRole("heading", { name: "Updated Browser Tournament", level: 1 }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Cancel event" }).click();
  await page.getByRole("button", { name: "Yes, cancel event" }).click();
  await expect(page).toHaveURL(/\/events\?event=cancelled$/);
  await expect(page.getByText("Event cancelled.")).toBeVisible();
});

test("team creation, joining, captain changes, and ownership transfer work through the runtime", async ({
  context,
  page,
}, testInfo) => {
  const device = deviceName(testInfo.project.name);

  await logIn(
    page,
    `member-${device}@example.test`,
    "/teams/joinable-browser-team",
  );
  await page.getByLabel("Team password").fill("BrowserTeamPass123!");
  await page.getByRole("button", { name: "Join team" }).click();
  await expect(page).toHaveURL(/\?team=joined$/);
  await expect(page.getByText("Your role: Member.")).toBeVisible();

  await context.clearCookies();
  await logIn(page, `owner-${device}@example.test`, "/teams/new");
  await page.getByLabel("Team name").fill("Browser Migration Team");
  await page
    .getByLabel("Description")
    .fill("A team created by the Start browser parity suite.");
  await page.getByRole("checkbox", { name: "Strategy Arena" }).check();
  await page.getByLabel("Join password").fill("BrowserTeamPass123!");
  await page.getByRole("button", { name: "Create team" }).click();
  await expect(page).toHaveURL(
    /\/teams\/browser-migration-team-[^?]+\?team=created$/,
  );
  await expect(page.getByText("Your role: Owner.")).toBeVisible();

  await page.getByRole("button", { name: "Make captain" }).click();
  await expect(page).toHaveURL(/\?team=captain-updated$/);
  await expect(
    page.getByRole("button", { name: "Remove captain" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Transfer ownership" }).click();
  await page.getByRole("button", { name: "Yes, transfer ownership" }).click();
  await expect(page).toHaveURL(/\?team=ownership-transferred$/);
  await expect(page.getByText("Your role: Member.")).toBeVisible();
});

test("support, user reporting, and school follow state work through the runtime", async ({
  page,
}, testInfo) => {
  const device = deviceName(testInfo.project.name);

  await gotoApp(page, "/support");
  await page.getByLabel("Email").fill(`support-${device}@example.test`);
  await page.getByLabel("Name").fill("Browser Support Player");
  await page.getByLabel("Subject").fill("Production migration question");
  await page
    .getByLabel("Message")
    .fill("Please verify the support submission boundary.");
  await page.getByRole("button", { name: "Submit support ticket" }).click();
  await expect(page.getByText("Support ticket submitted.")).toBeVisible();

  await logIn(
    page,
    `safety-${device}@example.test`,
    "/users/reportable-player",
  );
  await page.getByText("Report this user").click();
  await page
    .getByLabel("Reason")
    .fill("Testing the production user-report boundary.");
  await page.getByRole("button", { name: "Submit report" }).click();
  await expect(page.getByText("Report submitted for review.")).toBeVisible();

  await gotoApp(page, "/schools/follow-browser-university");
  await page.getByRole("button", { name: "Follow school" }).click();
  await expect(page).toHaveURL(/\?follow=added$/);
  await expect(page.getByText("School followed.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Unfollow" })).toBeVisible();

  await page.getByRole("button", { name: "Unfollow" }).click();
  await expect(page).toHaveURL(/\?follow=removed$/);
  await expect(page.getByText("School unfollowed.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Follow school" }),
  ).toBeVisible();
});

function hasCookie(
  cookies: Awaited<ReturnType<BrowserContext["cookies"]>>,
  name: string,
) {
  return cookies.some((cookie) => cookie.name === name);
}

function deviceName(projectName: string) {
  return projectName.startsWith("mobile") ? "mobile" : "desktop";
}
