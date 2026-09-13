import { expect, test, type Page } from "@playwright/test";

const apiURL = "http://127.0.0.1:18081";
const siteOrigin = "http://127.0.0.1:3200";
const publicCache = "public, max-age=0, must-revalidate";
const privateCache = "private, no-store";

type MetadataContract = {
  path: string;
  title: string;
  cache: typeof publicCache | typeof privateCache;
  noIndex?: boolean;
  openGraphPath?: string;
};

const pages: MetadataContract[] = [
  { path: "/", title: "Campus Gaming Network", cache: publicCache, openGraphPath: "" },
  { path: "/about", title: "About | Campus Gaming Network", cache: publicCache, openGraphPath: "/about" },
  { path: "/faq", title: "FAQ | Campus Gaming Network", cache: publicCache, openGraphPath: "/faq" },
  { path: "/privacy", title: "Privacy | Campus Gaming Network", cache: publicCache, openGraphPath: "/privacy" },
  { path: "/terms", title: "Terms | Campus Gaming Network", cache: publicCache, openGraphPath: "/terms" },
  { path: "/support", title: "Support | Campus Gaming Network", cache: publicCache, openGraphPath: "/support" },
  { path: "/login", title: "Log in | Campus Gaming Network", cache: publicCache, openGraphPath: "/login" },
  { path: "/signup?q=Browser", title: "Sign up | Campus Gaming Network", cache: publicCache, openGraphPath: "/signup" },
  { path: "/forgot-password", title: "Forgot password | Campus Gaming Network", cache: publicCache, noIndex: true, openGraphPath: "/forgot-password" },
  { path: "/reset-password?token=metadata-token", title: "Reset password | Campus Gaming Network", cache: privateCache, noIndex: true, openGraphPath: "/reset-password" },
  { path: "/auth/verify-email?token=metadata-token", title: "Verify email | Campus Gaming Network", cache: privateCache, noIndex: true, openGraphPath: "/auth/verify-email" },
  { path: "/events", title: "Events | Campus Gaming Network", cache: publicCache, openGraphPath: "/events" },
  { path: "/events/public-browser-event", title: "Public Browser Tournament | Campus Gaming Network", cache: privateCache, openGraphPath: "/events/public-browser-event" },
  { path: "/events/private-browser-event", title: "Private event | Campus Gaming Network", cache: privateCache, noIndex: true },
  { path: "/teams", title: "Teams | Campus Gaming Network", cache: publicCache, openGraphPath: "/teams" },
  { path: "/teams/joinable-browser-team", title: "Joinable Browser Team | Campus Gaming Network", cache: publicCache, openGraphPath: "/teams/joinable-browser-team" },
  { path: "/schools", title: "Schools | Campus Gaming Network", cache: publicCache, openGraphPath: "/schools" },
  { path: "/schools/follow-browser-university", title: "Follow Browser University | Campus Gaming Network", cache: privateCache, openGraphPath: "/schools/follow-browser-university" },
  { path: "/users/reportable-player", title: "Reportable Browser Player | Campus Gaming Network", cache: publicCache, openGraphPath: "/users/reportable-player" }
];

test.beforeEach(async ({ request }) => {
  const response = await request.post(`${apiURL}/__test/reset`);
  expect(response.ok()).toBe(true);
});

for (const expected of pages) {
  test(`${expected.path} has the complete metadata and cache contract`, async ({
    page
  }) => {
    const response = await page.goto(expected.path);
    await assertMetadataContract(page, response, expected);
  });
}

test("authenticated pages keep complete private metadata", async ({ page }) => {
  await logIn(page, "/account");

  await visitAndAssertMetadata(page, {
    path: "/account",
    title: "Account | Campus Gaming Network",
    cache: privateCache,
    noIndex: true,
    openGraphPath: "/account"
  });
  await visitAndAssertMetadata(page, {
    path: "/events/new",
    title: "Create event | Campus Gaming Network",
    cache: privateCache,
    noIndex: true,
    openGraphPath: "/events/new"
  });
  await visitAndAssertMetadata(page, {
    path: "/teams/new",
    title: "Start a team | Campus Gaming Network",
    cache: privateCache,
    noIndex: true,
    openGraphPath: "/teams/new"
  });

  await page.goto("/events/new");
  await page.getByLabel("Title").fill("Metadata Browser Event");
  await page
    .getByLabel("Description")
    .fill("An event used to verify private edit-page metadata.");
  await page.getByLabel("Starts at").fill("2037-08-15T13:00");
  await page.getByLabel("Ends at").fill("2037-08-15T16:00");
  await page.getByLabel("Location name").fill("Browser Student Union");
  await page.getByLabel("Games").selectOption("game-e2e");
  await page.getByRole("button", { name: "Create event" }).click();
  await expect(page).toHaveURL(/\/events\/metadata-browser-event-[^?]+\?event=created$/);

  const editPath = `${new URL(page.url()).pathname}/edit`;
  const editResponse = await page.goto(editPath);
  await assertMetadataContract(page, editResponse, {
    path: editPath,
    title: "Edit event | Campus Gaming Network",
    cache: privateCache,
    noIndex: true
  });
});

for (const path of [
  "/missing-browser-route",
  "/schools/missing-browser-school",
  "/events/missing-browser-event",
  "/teams/missing-browser-team",
  "/users/missing-browser-player"
]) {
  test(`${path} keeps the complete noindex 404 metadata contract`, async ({
    page
  }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
    await expect(page).toHaveTitle(
      "Page not found | Campus Gaming Network"
    );
    await expect(page.locator('meta[name="description"]')).toHaveCount(1);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      "That page does not exist on Campus Gaming Network."
    );
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex,nofollow"
    );
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
      "content",
      "Page not found | Campus Gaming Network"
    );
    await expect(page.locator('meta[property="og:description"]')).toHaveAttribute(
      "content",
      "That page does not exist on Campus Gaming Network."
    );
    await expect(page.locator('meta[property="og:url"]')).toHaveCount(0);
    await expect(page.locator('meta[name="twitter:title"]')).toHaveAttribute(
      "content",
      "Page not found | Campus Gaming Network"
    );
    await expect(page.locator('meta[name="twitter:description"]')).toHaveAttribute(
      "content",
      "That page does not exist on Campus Gaming Network."
    );
  });
}

async function visitAndAssertMetadata(
  page: Page,
  expected: MetadataContract
) {
  const response = await page.goto(expected.path);
  await assertMetadataContract(page, response, expected);
}

async function assertMetadataContract(
  page: Page,
  response: Awaited<ReturnType<Page["goto"]>>,
  expected: MetadataContract
) {
  expect(response?.status()).toBe(200);
  expect(response?.headers()["cache-control"]).toBe(expected.cache);
  await expect(page).toHaveTitle(expected.title);

  const description = await requiredMeta(page, 'meta[name="description"]');
  await expect(page.locator('meta[property="og:type"]')).toHaveAttribute(
    "content",
    "website"
  );
  await expect(page.locator('meta[property="og:site_name"]')).toHaveAttribute(
    "content",
    "Campus Gaming Network"
  );
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    "content",
    expected.title
  );
  await expect(page.locator('meta[property="og:description"]')).toHaveAttribute(
    "content",
    description
  );
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
    "content",
    "summary"
  );
  await expect(page.locator('meta[name="twitter:title"]')).toHaveAttribute(
    "content",
    expected.title
  );
  await expect(page.locator('meta[name="twitter:description"]')).toHaveAttribute(
    "content",
    description
  );

  if (expected.openGraphPath !== undefined) {
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
      "content",
      `${siteOrigin}${expected.openGraphPath}`
    );
  } else {
    await expect(page.locator('meta[property="og:url"]')).toHaveCount(0);
  }

  const robots = page.locator('meta[name="robots"]');
  if (expected.noIndex) {
    await expect(robots).toHaveAttribute("content", "noindex,nofollow");
  } else {
    await expect(robots).toHaveCount(0);
  }
}

async function logIn(page: Page, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill("metadata@example.test");
  await page.getByLabel("Password").fill("E2EPassword123!");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(new RegExp(`${escapeRegularExpression(next)}$`));
}

async function requiredMeta(page: Page, selector: string): Promise<string> {
  const content = await page.locator(selector).getAttribute("content");
  expect(content, `${selector} must have non-empty content`).toBeTruthy();
  return content ?? "";
}

function escapeRegularExpression(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
