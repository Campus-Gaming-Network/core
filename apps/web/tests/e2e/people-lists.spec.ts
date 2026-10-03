import { expect, test } from "@playwright/test";
import { gotoApp, logIn, waitForAppReady } from "./fixtures/app-navigation.js";

const apiURL = "http://127.0.0.1:18081";
const password = "E2EPassword123!";
const eventPassword = "E2EEventPassword123!";
const viewerEmail = "people-viewer@example.test";
// The fake API names every account this, and lists it where it belongs.
const viewerName = "Browser Test Player";

test.beforeEach(async ({ request }) => {
  const response = await request.post(`${apiURL}/__test/reset`);
  expect(response.ok()).toBe(true);
});

// The fake API numbers the people it lists, so a page and its order are known.
function names(label: string, first: number, last: number): string[] {
  return Array.from(
    { length: last - first + 1 },
    (_, index) => `${label} ${String(first + index).padStart(2, "0")}`,
  );
}

const lists = [
  {
    name: "event",
    path: "/events/public-browser-event",
    peoplePath: "/events/public-browser-event/people",
    prompt: "Log in to see who's going.",
  },
  {
    name: "school",
    path: "/schools/browser-test-university",
    peoplePath: "/schools/browser-test-university/people",
    prompt: "Log in to see the people at this school.",
  },
  {
    name: "team",
    path: "/teams/joinable-browser-team",
    peoplePath: "/teams/joinable-browser-team/people",
    prompt: "Log in to see the members of this team.",
  },
];

for (const list of lists) {
  test(`a visitor to the ${list.name} page is asked to log in instead of seeing the list`, async ({
    page,
  }) => {
    await gotoApp(page, list.path);

    const prompt = page.getByRole("note").filter({ hasText: list.prompt });
    await expect(prompt).toBeVisible();
    await expect(page.locator(".people-list")).toHaveCount(0);

    await prompt.getByRole("link", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/login\?/);
    expect(new URL(page.url()).searchParams.get("next")).toBe(list.path);
  });

  test(`a visitor who opens the ${list.name} people page is sent to log in and brought back`, async ({
    page,
  }) => {
    await gotoApp(page, list.peoplePath);

    await expect(page).toHaveURL(/\/login\?/);
    expect(new URL(page.url()).searchParams.get("next")).toBe(list.peoplePath);
    await page.getByLabel("Email").fill(viewerEmail);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Log in" }).click();

    await expect(page).toHaveURL(list.peoplePath);
    await waitForAppReady(page);
    await expect(page.locator("main .people-list li").first()).toBeVisible();
  });
}

test("a visitor who opens the Maybe tab keeps it through log in", async ({
  page,
}) => {
  const path = "/events/public-browser-event/people?response=maybe";
  await gotoApp(page, path);

  expect(new URL(page.url()).searchParams.get("next")).toBe(path);
  await page.getByLabel("Email").fill(viewerEmail);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();

  await expect(page).toHaveURL(path);
  await waitForAppReady(page);
  await expect(page.locator("main .person__text a")).toHaveText(
    names("Maybe Player", 1, 3),
  );
});

test("a signed-in viewer previews who is going, then pages through everyone and the maybes", async ({
  page,
}) => {
  await logIn(page, viewerEmail, "/events/public-browser-event");

  const card = page.getByRole("region", { name: "Who's going" });
  await expect(card.locator(".person__text a")).toHaveText(
    names("Going Player", 1, 8),
  );
  await expect(card.getByRole("listitem").first()).toContainText(
    "Verified student · School admin",
  );
  await expect(card.getByRole("listitem").nth(1)).toContainText(
    "Community member",
  );
  await expect(page.getByRole("note")).toHaveCount(0);

  await card.getByRole("link", { name: "See everyone" }).click();
  await expect(page).toHaveURL("/events/public-browser-event/people");
  await waitForAppReady(page);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Who's going to Public Browser Tournament",
    }),
  ).toBeVisible();

  const people = page.locator("main .person__text a");
  const pages = page.getByRole("navigation", { name: "Attendee pages" });
  const tabs = page.getByRole("navigation", { name: "RSVP responses" });
  await expect(people).toHaveText(names("Going Player", 1, 24));
  await expect(pages.getByRole("link", { name: "Previous" })).toHaveCount(0);

  await pages.getByRole("link", { name: "Next" }).click();
  await waitForAppReady(page);
  await expect(people).toHaveText(names("Going Player", 25, 30));
  expect(new URL(page.url()).searchParams.has("after")).toBe(true);
  await expect(pages.getByRole("link", { name: "Next" })).toHaveCount(0);

  await pages.getByRole("link", { name: "Previous" }).click();
  await waitForAppReady(page);
  await expect(people).toHaveText(names("Going Player", 1, 24));

  await tabs.getByRole("link", { name: "Maybe" }).click();
  await expect(page).toHaveURL(
    "/events/public-browser-event/people?response=maybe",
  );
  await waitForAppReady(page);
  await expect(people).toHaveText(names("Maybe Player", 1, 3));
  await expect(tabs.getByRole("link", { name: "Maybe" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(tabs.getByRole("link", { name: "Going" })).not.toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(pages).toHaveCount(0);

  await tabs.getByRole("link", { name: "Going" }).click();
  await waitForAppReady(page);
  await expect(people).toHaveText(names("Going Player", 1, 24));
  await expect(tabs.getByRole("link", { name: "Going" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  await page.getByRole("link", { name: "Back to event" }).click();
  await expect(page).toHaveURL("/events/public-browser-event");
});

test("a signed-in viewer previews a school's people and pages through them", async ({
  page,
}) => {
  await logIn(page, viewerEmail, "/schools/browser-test-university");

  // The viewer's home school is this school, so they are listed first.
  const section = page.getByRole("region", { name: "People" });
  await expect(section.locator(".person__text a")).toHaveText([
    viewerName,
    ...names("School Member", 1, 7),
  ]);
  await expect(page.getByRole("note")).toHaveCount(0);

  await section.getByRole("link", { name: "See everyone" }).click();
  await expect(page).toHaveURL("/schools/browser-test-university/people");
  await waitForAppReady(page);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "People at Browser Test University",
    }),
  ).toBeVisible();

  const people = page.locator("main .person__text a");
  const pages = page.getByRole("navigation", { name: "Member pages" });
  await expect(people).toHaveText([
    viewerName,
    ...names("School Member", 1, 23),
  ]);
  await pages.getByRole("link", { name: "Next" }).click();
  await waitForAppReady(page);
  await expect(people).toHaveText(names("School Member", 24, 30));
  await pages.getByRole("link", { name: "Previous" }).click();
  await waitForAppReady(page);
  await expect(people).toHaveText([
    viewerName,
    ...names("School Member", 1, 23),
  ]);

  await page.getByRole("link", { name: "Back to school" }).click();
  await expect(page).toHaveURL("/schools/browser-test-university");
});

test("a signed-in viewer previews a team's members with their roles and pages through them", async ({
  page,
}) => {
  await logIn(page, viewerEmail, "/teams/joinable-browser-team");

  const card = page.getByRole("region", { name: "Members" });
  await expect(card.locator(".person__text a")).toHaveText(
    names("Team Member", 1, 8),
  );
  await expect(card.locator(".person__text small")).toHaveText([
    "Owner",
    "Captain",
    "Captain",
    "Member",
    "Member",
    "Member",
    "Member",
    "Member",
  ]);
  await expect(page.getByRole("note")).toHaveCount(0);

  await card.getByRole("link", { name: "See everyone" }).click();
  await expect(page).toHaveURL("/teams/joinable-browser-team/people");
  await waitForAppReady(page);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "People on Joinable Browser Team",
    }),
  ).toBeVisible();

  const people = page.locator("main .person__text a");
  const pages = page.getByRole("navigation", { name: "Member pages" });
  await expect(people).toHaveText(names("Team Member", 1, 24));
  await pages.getByRole("link", { name: "Next" }).click();
  await waitForAppReady(page);
  await expect(people).toHaveText(names("Team Member", 25, 30));
  await pages.getByRole("link", { name: "Previous" }).click();
  await waitForAppReady(page);
  await expect(people).toHaveText(names("Team Member", 1, 24));

  await page.getByRole("link", { name: "Back to team" }).click();
  await expect(page).toHaveURL("/teams/joinable-browser-team");
});

test("empty lists say so, and the Maybe tab has its own empty state", async ({
  page,
}) => {
  await logIn(page, viewerEmail, "/events/quiet-browser-event");

  await expect(
    page
      .getByRole("region", { name: "Who's going" })
      .getByText("No one has RSVP'd yet."),
  ).toBeVisible();
  await gotoApp(page, "/events/quiet-browser-event/people");
  await expect(
    page.getByRole("heading", { level: 2, name: "No one has RSVP'd yet" }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "RSVP responses" })
    .getByRole("link", { name: "Maybe" })
    .click();
  await expect(
    page.getByRole("heading", { level: 2, name: "No maybes yet" }),
  ).toBeVisible();

  await gotoApp(page, "/schools/quiet-valley-college");
  const school = page.getByRole("region", { name: "People" });
  await expect(school.getByText("No members yet.")).toBeVisible();
  await expect(school.getByRole("link", { name: "See everyone" })).toHaveCount(
    0,
  );
  await gotoApp(page, "/schools/quiet-valley-college/people");
  await expect(
    page.getByRole("heading", { level: 2, name: "No members yet" }),
  ).toBeVisible();

  await gotoApp(page, "/teams/empty-browser-team");
  await expect(
    page.getByRole("region", { name: "Members" }).getByText("No members yet."),
  ).toBeVisible();
  await gotoApp(page, "/teams/empty-browser-team/people");
  await expect(
    page.getByRole("heading", { level: 2, name: "No members yet" }),
  ).toBeVisible();
});

for (const outage of [
  {
    name: "event",
    path: "/events/unavailable-people-event",
    heading: "Hazy Browser Meetup",
    peoplePath: "/events/unavailable-people-event/people",
    unavailable: "Attendees are unavailable right now",
  },
  {
    name: "school",
    path: "/schools/hazy-harbor-college",
    heading: "Hazy Harbor College",
    peoplePath: "/schools/hazy-harbor-college/people",
    unavailable: "Members are unavailable right now",
  },
  {
    name: "team",
    path: "/teams/unavailable-people-team",
    heading: "Joinable Browser Team",
    peoplePath: "/teams/unavailable-people-team/people",
    unavailable: "Members are unavailable right now",
  },
]) {
  test(`a failing ${outage.name} list leaves its page up with a quiet note and its own page says so`, async ({
    page,
  }) => {
    await logIn(page, viewerEmail, outage.path);

    await expect(
      page.getByRole("heading", { level: 1, name: outage.heading }),
    ).toBeVisible();
    await expect(
      page.getByText("This list is unavailable right now."),
    ).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);

    await gotoApp(page, outage.peoplePath);
    const alert = page.getByRole("alert");
    await expect(
      alert.getByRole("heading", { name: outage.unavailable }),
    ).toBeVisible();
    await expect(
      alert.getByRole("link", { name: "Try again" }),
    ).toHaveAttribute("href", outage.peoplePath);
    await expect(page.locator("main h1")).toHaveCount(1);
  });
}

test("a private event's list stays hidden until the viewer unlocks it, then includes those who RSVP", async ({
  page,
}) => {
  const slug = "private-browser-lists";
  await logIn(page, viewerEmail, `/events/${slug}`);

  const locked = await gotoApp(page, `/events/${slug}/people`);
  expect(locked?.status()).toBe(404);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "We could not find that page.",
    }),
  ).toBeVisible();

  await gotoApp(page, `/events/${slug}`);
  await page.getByLabel("Event password").fill(eventPassword);
  await page.getByRole("button", { name: "Unlock event" }).click();
  await expect(page).toHaveURL(`/events/${slug}?event=unlocked`);
  await waitForAppReady(page);

  const card = page.getByRole("region", { name: "Who's going" });
  await expect(card.getByText("No one has RSVP'd yet.")).toBeVisible();

  await page.getByRole("button", { name: "Yes", exact: true }).click();
  await expect(page).toHaveURL(`/events/${slug}?event=rsvp-updated`);
  await waitForAppReady(page);
  await expect(card.locator(".person__text a")).toHaveText([viewerName]);

  await gotoApp(page, `/events/${slug}/people`);
  await expect(page.locator("main .person__text a")).toHaveText([viewerName]);
});

test("the Show me in member lists setting round trips and hides the viewer from lists", async ({
  page,
}) => {
  const listed = page.locator("main .people-list .person__text a", {
    hasText: viewerName,
  });
  const setting = page.getByRole("checkbox", {
    name: "Show me in member lists",
  });

  await logIn(page, viewerEmail, "/schools/browser-test-university/people");
  await expect(listed).toHaveCount(1);

  await gotoApp(page, "/account");
  await expect(setting).toBeChecked();
  await expect(
    page.getByText(
      "Signed-in people can see you in lists of event attendees, school members, and team members. Turn this off to hide yourself.",
    ),
  ).toBeVisible();
  await setting.uncheck();
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page).toHaveURL("/account?account=profile-updated");
  await waitForAppReady(page);
  await page.reload();
  await waitForAppReady(page);
  await expect(setting).not.toBeChecked();

  await gotoApp(page, "/schools/browser-test-university/people");
  await expect(listed).toHaveCount(0);
  await expect(page.locator("main .person__text a")).toHaveText(
    names("School Member", 1, 24),
  );

  await gotoApp(page, "/account");
  await setting.check();
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page).toHaveURL("/account?account=profile-updated");
  await waitForAppReady(page);
  await page.reload();
  await waitForAppReady(page);
  await expect(setting).toBeChecked();

  await gotoApp(page, "/schools/browser-test-university/people");
  await expect(listed).toHaveCount(1);
});

for (const people of [
  {
    path: "/events/public-browser-event/people",
    title: "Who's going to Public Browser Tournament | Campus Gaming Network",
  },
  {
    path: "/schools/browser-test-university/people",
    title: "People at Browser Test University | Campus Gaming Network",
  },
  {
    path: "/teams/joinable-browser-team/people",
    title: "People on Joinable Browser Team | Campus Gaming Network",
  },
]) {
  test(`${people.path} is private, never cached, and out of search results`, async ({
    page,
  }) => {
    await logIn(page, viewerEmail, "/account");

    const response = await gotoApp(page, people.path);
    expect(response?.status()).toBe(200);
    expect(response?.headers()["cache-control"]).toBe("private, no-store");
    expect(response?.headers().vary).toContain("Cookie");
    await expect(page).toHaveTitle(people.title);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex,nofollow",
    );
  });
}

test("people lists give phones 44px targets", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  await logIn(page, viewerEmail, "/schools/browser-test-university");

  const undersized = () =>
    page
      .locator(
        ".people-list .person__text a, .people-pagination a, .section-heading a, .detail-card-body a",
      )
      .evaluateAll((controls) =>
        controls
          .filter(
            (control) => control.getBoundingClientRect().height < 44 - 0.5,
          )
          .map((control) => control.textContent?.trim()),
      );

  expect(await undersized()).toEqual([]);
  await gotoApp(page, "/schools/browser-test-university/people");
  expect(await undersized()).toEqual([]);
  await gotoApp(page, "/events/public-browser-event");
  expect(await undersized()).toEqual([]);
  await gotoApp(page, "/events/public-browser-event/people");
  expect(await undersized()).toEqual([]);
  await gotoApp(page, "/teams/joinable-browser-team");
  expect(await undersized()).toEqual([]);
});
