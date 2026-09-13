import { expect, test } from "@playwright/test";

const apiURL = "http://127.0.0.1:18081";
const eventPassword = "E2EEventPassword123!";
const password = "E2EPassword123!";
const unlockCookieSecure =
  process.env.WEB_BROWSER_RUNTIME !== "development";
const privateMarkers = [
  "Invitation-Only Strategy Session",
  "Private plans shared only after the event is unlocked.",
  "Private Student Union Room",
  "123 Hidden Campus Way"
];

test("private event auth, RSVP, and logout survive runtime navigation", async ({
  context,
  page,
  request
}, testInfo) => {
  const reset = await request.post(`${apiURL}/__test/reset`);
  expect(reset.ok()).toBe(true);

  const device = testInfo.project.name.startsWith("mobile")
    ? "mobile"
    : "desktop";
  const slug = `private-browser-${device}`;
  const email = `${device}-player@example.test`;

  const lockedResponse = await page.goto(`/events/${slug}`);
  expect(lockedResponse?.status()).toBe(200);
  await expect(page).toHaveTitle("Private event | Campus Gaming Network");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    "noindex,nofollow"
  );
  await expect(
    page.getByRole("heading", { name: "This event is private.", level: 1 })
  ).toBeVisible();
  const lockedHTML = await page.content();
  for (const marker of privateMarkers) {
    expect(lockedHTML).not.toContain(marker);
  }

  await page.getByLabel("Event password").fill(eventPassword);
  await page.getByRole("button", { name: "Unlock event" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/events/${slug}\\?event=unlocked$`)
  );
  await expect(
    page.getByRole("heading", { name: privateMarkers[0], level: 1 })
  ).toBeVisible();

  const unlockCookieName = `cgn_event_unlock_${slug}`;
  await expect
    .poll(async () => cookieShape(await context.cookies(), unlockCookieName))
    .toEqual({
      present: true,
      hasValue: true,
      httpOnly: true,
      secure: unlockCookieSecure,
      sameSite: "Lax",
      path: "/"
    });

  await page.getByRole("link", { name: "Log in to RSVP" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();

  await expect(page).toHaveURL(new RegExp(`/events/${slug}$`));
  await expect
    .poll(async () => cookieShape(await context.cookies(), "cgn_session"))
    .toEqual({
      present: true,
      hasValue: true,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      path: "/"
    });
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();

  await page.reload();
  await expect(page).toHaveTitle(
    `${privateMarkers[0]} | Campus Gaming Network`
  );
  await expect(
    page.getByRole("heading", { name: privateMarkers[0], level: 1 })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();

  await page.getByRole("button", { name: "Yes" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/events/${slug}\\?event=rsvp-updated$`)
  );
  await expect(page.getByRole("status")).toHaveText("RSVP saved.");
  await expect(page.getByText("Current RSVP:")).toContainText("Yes");

  await page.getByRole("link", { name: "Campus Gaming Network" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("link", { name: "Log in" })).toBeVisible();
  await expect
    .poll(async () => cookieShape(await context.cookies(), "cgn_session"))
    .toEqual({ present: false });

  const stateResponse = await request.get(`${apiURL}/__test/state`);
  expect(stateResponse.ok()).toBe(true);
  await expect(stateResponse.json()).resolves.toEqual({
    loginCalls: 1,
    unlockCalls: 1,
    rsvpCalls: 1,
    logoutCalls: 1,
    logoutReceivedSession: true
  });
});

function cookieShape(
  cookies: ReadonlyArray<{
    name: string;
    value: string;
    httpOnly: boolean;
    secure: boolean;
    sameSite: string;
    path: string;
  }>,
  name: string
) {
  const cookie = cookies.find((candidate) => candidate.name === name);
  if (!cookie) {
    return { present: false as const };
  }
  return {
    present: true as const,
    hasValue: cookie.value.length > 0,
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    sameSite: cookie.sameSite,
    path: cookie.path
  };
}
