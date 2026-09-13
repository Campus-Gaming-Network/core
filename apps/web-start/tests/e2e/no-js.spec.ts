import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const apiURL = "http://127.0.0.1:18081";
const password = "E2EPassword123!";
const eventPassword = "E2EEventPassword123!";

test.beforeEach(async ({ request }) => {
  const response = await request.post(`${apiURL}/__test/reset`);
  expect(response.ok()).toBe(true);
});

test("native login rejects control-character redirect targets", async ({ page }) => {
  const unsafeNext = new URLSearchParams({
    next: "/\t/attacker.example"
  });
  await page.goto(`/login?${unsafeNext}`);
  await page.getByLabel("Email").fill("safe-redirect-no-js@example.test");
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/account$/);
});

test("public auth and support forms complete without JavaScript", async ({
  page
}) => {
  await page.goto("/signup?q=Browser");
  await page.getByLabel("Name").fill("No JavaScript Player");
  await page.getByLabel("Email").fill("no-js-signup@example.test");
  await page.getByLabel("Password").fill(password);
  await page.getByLabel("Home school").selectOption("school-e2e");
  await page.getByRole("checkbox", { name: /18 or older/ }).check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/signup\?auth=created$/);
  await expect(page.getByText("Account created. Check your email")).toBeVisible();

  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill("no-js-recovery@example.test");
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page).toHaveURL(/\/forgot-password\?request=sent$/);

  await page.goto("/auth/verify-email");
  await page.getByLabel("Email").fill("no-js-resend@example.test");
  await page.getByRole("button", { name: "Resend verification" }).click();
  await expect(page).toHaveURL(/\/auth\/verify-email\?resend=sent$/);

  await page.goto("/auth/verify-email?token=valid-verification-no-js");
  await page.getByRole("button", { name: "Verify email" }).click();
  await expect(page).toHaveURL(/\/auth\/verify-email\?verified=complete$/);

  await page.goto("/auth/reset-password?token=valid-reset-no-js");
  await page.getByLabel("New password").fill("UpdatedPassword123!");
  await page.getByRole("button", { name: "Reset password" }).click();
  await expect(page).toHaveURL(/\/login\?reset=complete$/);

  await page.goto("/support");
  await page.getByLabel("Email").fill("no-js-support@example.test");
  await page.getByLabel("Name").fill("No JavaScript Player");
  await page.getByLabel("Subject").fill("Native form migration check");
  await page
    .getByLabel("Message")
    .fill("Verify the support form completes without browser JavaScript.");
  await page.getByRole("button", { name: "Submit support ticket" }).click();
  await expect(page).toHaveURL(/\/support\?support=submitted$/);
  await expect(page.getByText("Support ticket submitted.")).toBeVisible();
});

test("account, safety, and school forms complete without JavaScript", async ({
  context,
  page
}) => {
  await logIn(page, "no-js-account@example.test", "/account");

  await page.getByLabel("Name").fill("Updated No JavaScript Player");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page).toHaveURL(/\/account\?account=profile-updated$/);
  await expect(
    page.getByRole("heading", {
      name: "Updated No JavaScript Player",
      level: 1
    })
  ).toBeVisible();

  await page.goto("/users/reportable-player");
  await page
    .getByLabel("Reason")
    .fill("Verify the user report native submission boundary.");
  await page.getByRole("button", { name: "Submit report" }).click();
  await expect(page).toHaveURL(
    /\/users\/reportable-player\?report=submitted$/
  );

  await page.goto("/schools/follow-browser-university");
  await page.getByRole("button", { name: "Follow school" }).click();
  await expect(page).toHaveURL(/\?follow=added$/);
  await page.getByRole("button", { name: "Unfollow" }).click();
  await expect(page).toHaveURL(/\?follow=removed$/);

  await page.goto("/account");
  await page.getByLabel("Type DELETE to confirm").fill("DELETE");
  await page.getByRole("button", { name: "Delete account" }).click();
  await expect(page).toHaveURL(/\/\?account=deleted$/);
  await expect
    .poll(async () => hasCookie(await context.cookies(), "cgn_session"))
    .toBe(false);
});

test("event forms complete without JavaScript", async ({ context, page }) => {
  const privateSlug = "private-no-js";

  await page.goto(`/events/${privateSlug}`);
  await page.getByLabel("Event password").fill(eventPassword);
  await page.getByRole("button", { name: "Unlock event" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/events/${privateSlug}\\?event=unlocked$`)
  );

  await logIn(page, "no-js-event@example.test", `/events/${privateSlug}`);
  await page.getByRole("button", { name: "Yes" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/events/${privateSlug}\\?event=rsvp-updated$`)
  );
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();

  await page.goto("/events/new");
  await page.getByLabel("Title").fill("No JavaScript Tournament");
  await page
    .getByLabel("Description")
    .fill("A native form migration test event.");
  await page.getByLabel("Starts at").fill("2037-08-15T13:00");
  await page.getByLabel("Ends at").fill("2037-08-15T16:00");
  await page.getByLabel("Location name").fill("No JavaScript Student Union");
  await page.getByLabel("Games").selectOption("game-e2e");
  await page.getByLabel("Capacity").fill("24");
  await page.getByRole("button", { name: "Create event" }).click();
  await expect(page).toHaveURL(
    /\/events\/no-javascript-tournament-[^?]+\?event=created$/
  );

  await page
    .getByLabel("Reason")
    .fill("Verify the event report native submission boundary.");
  await page.getByRole("button", { name: "Submit report" }).click();
  await expect(page).toHaveURL(/\?event=report-submitted$/);
  await expect(page.getByText("Report submitted for review.")).toBeVisible();

  await page.getByRole("button", { name: "I'm interested" }).click();
  await expect(page).toHaveURL(/\?event=interest-added$/);

  await page.getByRole("link", { name: "Edit event" }).click();
  await page.getByLabel("Title").fill("Updated No JavaScript Tournament");
  await page.getByRole("button", { name: "Save event" }).click();
  await expect(page).toHaveURL(/\?event=updated$/);

  await page.getByRole("button", { name: "Cancel event" }).click();
  await expect(page).toHaveURL(/\/events\?event=cancelled$/);
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect
    .poll(async () => hasCookie(await context.cookies(), "cgn_session"))
    .toBe(false);
});

test("team forms complete without JavaScript", async ({ context, page }) => {
  await logIn(
    page,
    "no-js-member@example.test",
    "/teams/joinable-browser-team"
  );
  await page.getByLabel("Team password").fill("BrowserTeamPass123!");
  await page.getByRole("button", { name: "Join team" }).click();
  await expect(page).toHaveURL(/\?team=joined$/);

  await context.clearCookies();
  await logIn(page, "owner-no-js@example.test", "/teams/new");
  await page.getByLabel("Team name").fill("No JavaScript Team");
  await page
    .getByLabel("Description")
    .fill("A team created through a native form submission.");
  await page.getByRole("checkbox", { name: "Strategy Arena" }).check();
  await page.getByLabel("Join password").fill("BrowserTeamPass123!");
  await page.getByRole("button", { name: "Create team" }).click();
  await expect(page).toHaveURL(
    /\/teams\/no-javascript-team-[^?]+\?team=created$/
  );

  await page.getByRole("button", { name: "Make captain" }).click();
  await expect(page).toHaveURL(/\?team=captain-updated$/);
  await page.getByRole("button", { name: "Transfer ownership" }).click();
  await expect(page).toHaveURL(/\?team=ownership-transferred$/);
});

async function logIn(page: Page, email: string, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(new RegExp(`${escapeRegularExpression(next)}$`));
}

function hasCookie(
  cookies: Awaited<ReturnType<BrowserContext["cookies"]>>,
  name: string
) {
  return cookies.some((cookie) => cookie.name === name);
}

function escapeRegularExpression(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
