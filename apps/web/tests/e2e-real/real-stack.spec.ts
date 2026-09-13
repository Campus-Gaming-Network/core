import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
  type TestInfo
} from "@playwright/test";

const resendURL = "http://127.0.0.1:18083";
const primarySchoolID = "10000000-0000-0000-0000-000000000001";
const password = "E2EPassword123!";
const privateEventPassword = "PrivateEvent123!";
const teamPassword = "TeamPassword123!";
const cloudflareSecret = "real-e2e-cloudflare-secret-00000000";

type StubMessage = {
  id: string;
  from: string;
  to: string[];
  subject: string;
  html: string;
  attachments: unknown[];
  idempotencyKey: string;
};

test("real browser journey crosses the BFF, Go API, Postgres, and email outbox", async ({
  context,
  page,
  request
}, testInfo) => {
  const suffix = runSuffix(testInfo);
  await context.setExtraHTTPHeaders(
    trustedHeaders(`198.51.100.${100 + testInfo.repeatEachIndex * 4 + testInfo.retry}`)
  );
  const ownerEmail = `real-owner-${suffix}@example.test`;
  const attendeeEmail = `real-attendee-${suffix}@example.test`;
  const eventTitle = `Real Stack Private Event ${suffix}`;
  const teamName = `Real Stack Team ${suffix}`;

  await signUpVerifyAndLogIn(page, request, ownerEmail, "Real Stack Owner", "/events/new");

  await page.getByLabel("Title").fill(eventTitle);
  await page.getByLabel("Description").fill("A full-stack private event fixture.");
  await page.getByLabel("Visibility").selectOption("private");
  await page.getByLabel("Starts at").fill("2037-08-15T13:00");
  await page.getByLabel("Ends at").fill("2037-08-15T15:00");
  await page.getByLabel("Location name").fill("Real Stack Student Union");
  await page.getByLabel("Games").selectOption({ label: "Strategy Arena" });
  await page.getByLabel("Private event password").fill(privateEventPassword);
  await page.getByRole("button", { name: "Create event" }).click();
  await expect(page).toHaveURL(/\/events\/real-stack-private-event-[^?]+\?event=created$/);
  await expect(page.getByRole("heading", { name: eventTitle, level: 1 })).toBeVisible();
  const eventSlug = resourceSlug(page, "events");

  await page.goto("/teams/new");
  await page.getByLabel("Team name").fill(teamName);
  await page.getByLabel("Description").fill("A full-stack team fixture.");
  await page.getByRole("checkbox", { name: "Strategy Arena" }).check();
  await page.getByLabel("Join password").fill(teamPassword);
  await page.getByRole("button", { name: "Create team" }).click();
  await expect(page).toHaveURL(/\/teams\/real-stack-team-[^?]+\?team=created$/);
  await expect(page.getByText("Your role: Owner.")).toBeVisible();
  const teamSlug = resourceSlug(page, "teams");

  await context.clearCookies();
  await signUpVerifyAndLogIn(
    page,
    request,
    attendeeEmail,
    "Real Stack Attendee",
    `/events/${eventSlug}`
  );

  await expect(page.getByRole("heading", { name: "This event is private.", level: 1 })).toBeVisible();
  await page.getByLabel("Event password").fill(privateEventPassword);
  await page.getByRole("button", { name: "Unlock event" }).click();
  await expect(page).toHaveURL(new RegExp(`/events/${eventSlug}\\?event=unlocked$`));
  await expect(page.getByRole("heading", { name: eventTitle, level: 1 })).toBeVisible();

  await page.getByRole("button", { name: "Yes", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("RSVP saved.");
  const rsvpMessage = await waitForMessage(request, attendeeEmail, `You're going to ${eventTitle}`);
  expect(rsvpMessage.attachments).toHaveLength(1);
  expect(rsvpMessage.idempotencyKey).not.toBe("");

  await page.goto(`/teams/${teamSlug}`);
  await page.getByLabel("Team password").fill(teamPassword);
  await page.getByRole("button", { name: "Join team" }).click();
  await expect(page).toHaveURL(new RegExp(`/teams/${teamSlug}\\?team=joined$`));
  await expect(page.getByText("Your role: Member.")).toBeVisible();

  await page.goto("/account");
  await page.getByLabel("Type DELETE to confirm").fill("DELETE");
  await page.getByRole("button", { name: "Delete account" }).click();
  await expect(page).toHaveURL(/\/\?account=deleted$/);
  await expect
    .poll(async () => hasCookie(await context.cookies(), "cgn_session"))
    .toBe(false);
});

test("trusted visitor identity keeps rate limits separate through the BFF", async ({
  browser
}, testInfo) => {
  const identity = 20 + testInfo.repeatEachIndex * 4 + testInfo.retry * 2;
  const limitedContext = await trustedContext(browser, `198.51.100.${identity}`);
  const otherContext = await trustedContext(browser, `198.51.100.${identity + 1}`);

  try {
    const limitedPage = await limitedContext.newPage();
    await expectLoginMessage(
      limitedPage,
      `missing-${runSuffix(testInfo)}-1@example.test`,
      "The email or password did not match."
    );
    await expectLoginMessage(
      limitedPage,
      `missing-${runSuffix(testInfo)}-2@example.test`,
      "The email or password did not match."
    );
    await expectLoginMessage(
      limitedPage,
      `missing-${runSuffix(testInfo)}-3@example.test`,
      "The email or password did not match."
    );
    await expectLoginMessage(
      limitedPage,
      `limited-${runSuffix(testInfo)}@example.test`,
      "Too many attempts. Give it a minute, then try again."
    );

    const otherPage = await otherContext.newPage();
    await expectLoginMessage(
      otherPage,
      `other-${runSuffix(testInfo)}@example.test`,
      "The email or password did not match."
    );
  } finally {
    await limitedContext.close();
    await otherContext.close();
  }
});

async function signUpVerifyAndLogIn(
  page: Page,
  request: APIRequestContext,
  email: string,
  name: string,
  next: string
) {
  await page.goto(`/signup?q=Real&school_id=${primarySchoolID}`);
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByLabel("Home school").selectOption(primarySchoolID);
  await page.getByRole("checkbox", { name: /18 or older/ }).check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Account created. Check your email" })
  ).toBeVisible();

  const message = await waitForMessage(request, email, "Verify your Campus Gaming Network email");
  const token = verificationToken(message.html);
  await page.goto(`/auth/verify-email?token=${encodeURIComponent(token)}`);
  await page.getByRole("button", { name: "Verify email" }).click();
  await expect(page.getByRole("status")).toContainText("Your email is verified.");

  await logIn(page, email, next);
}

async function logIn(page: Page, email: string, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(new RegExp(`${escapeRegularExpression(next)}$`));
}

async function waitForMessage(
  request: APIRequestContext,
  recipient: string,
  subject: string
): Promise<StubMessage> {
  let found: StubMessage | undefined;
  await expect
    .poll(async () => {
      const response = await request.get(
        `${resendURL}/__test/messages?recipient=${encodeURIComponent(recipient)}`
      );
      expect(response.ok()).toBe(true);
      const payload = (await response.json()) as { messages: StubMessage[] };
      found = payload.messages.find((message) => message.subject === subject);
      return Boolean(found);
    })
    .toBe(true);
  return found!;
}

function verificationToken(html: string): string {
  const match = html.match(/[?&]token=([^"&<]+)/);
  if (!match) throw new Error("verification email did not contain a token link");
  return decodeURIComponent(match[1].replaceAll("+", " "));
}

function resourceSlug(page: Page, collection: "events" | "teams") {
  const parts = new URL(page.url()).pathname.split("/").filter(Boolean);
  if (parts[0] !== collection || !parts[1]) {
    throw new Error(`expected a ${collection} detail URL`);
  }
  return parts[1];
}

function runSuffix(testInfo: TestInfo) {
  return `repeat${testInfo.repeatEachIndex}-retry${testInfo.retry}`;
}

async function trustedContext(
  browser: Browser,
  visitorIP: string
): Promise<BrowserContext> {
  return browser.newContext({
    extraHTTPHeaders: trustedHeaders(visitorIP)
  });
}

function trustedHeaders(visitorIP: string) {
  return {
    "CF-Connecting-IP": visitorIP,
    "X-CGN-Cloudflare-Secret": cloudflareSecret
  };
}

async function expectLoginMessage(page: Page, email: string, message: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("WrongPassword123!");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("alert")).toContainText(message);
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
