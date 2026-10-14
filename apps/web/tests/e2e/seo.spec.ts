import { expect, test, type Page } from "@playwright/test";

// Crawlers and chat apps read the server-rendered HTML and run no script, so
// every assertion here runs with JavaScript off.
test.use({ javaScriptEnabled: false });

const apiURL = "http://127.0.0.1:18081";
const siteOrigin = "http://127.0.0.1:3200";

test.beforeEach(async ({ request }) => {
  const response = await request.post(`${apiURL}/__test/reset`);
  expect(response.ok()).toBe(true);
});

async function jsonLd(page: Page): Promise<unknown[]> {
  const scripts = await page
    .locator('script[type="application/ld+json"]')
    .allTextContents();
  return scripts.map((text) => JSON.parse(text) as unknown);
}

test("robots.txt keeps crawlers out of a non-production build", async ({
  request,
}) => {
  const response = await request.get("/robots.txt");

  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("text/plain; charset=utf-8");
  expect(await response.text()).toBe("User-agent: *\nDisallow: /\n");
});

test("sitemap.xml lists public pages and no private, auth, account, or profile page", async ({
  request,
}) => {
  const response = await request.get("/sitemap.xml");
  const body = await response.text();

  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe(
    "application/xml; charset=utf-8",
  );
  expect(body).toBe(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${siteOrigin}</loc></url>
  <url><loc>${siteOrigin}/events</loc></url>
  <url><loc>${siteOrigin}/schools</loc></url>
  <url><loc>${siteOrigin}/teams</loc></url>
  <url><loc>${siteOrigin}/about</loc></url>
  <url><loc>${siteOrigin}/faq</loc></url>
  <url><loc>${siteOrigin}/terms</loc></url>
  <url><loc>${siteOrigin}/privacy</loc></url>
  <url><loc>${siteOrigin}/events/summit-ridge-open-night</loc><lastmod>2037-09-01T12:00:00Z</lastmod></url>
  <url><loc>${siteOrigin}/schools/browser-test-university</loc><lastmod>2037-09-01T12:00:00Z</lastmod></url>
</urlset>
`);
});

test("the home page has a canonical link and a large preview card", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    siteOrigin,
  );
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    `${siteOrigin}/og-default.png`,
  );
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
    "content",
    "summary_large_image",
  );
  const image = await page.request.get("/og-default.png");
  expect(image.status()).toBe(200);
  expect(image.headers()["content-type"]).toBe("image/png");
});

test("a school page names a CollegeOrUniversity to crawlers", async ({
  page,
}) => {
  await page.goto("/schools/browser-test-university");

  const [data] = await jsonLd(page);
  expect(data).toMatchObject({
    "@context": "https://schema.org",
    "@type": "CollegeOrUniversity",
    name: "Browser Test University",
    url: `${siteOrigin}/schools/browser-test-university`,
  });
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    `${siteOrigin}/schools/browser-test-university`,
  );
});

test("a team page names a SportsTeam to crawlers and no person", async ({
  page,
}) => {
  await page.goto("/teams/joinable-browser-team");

  const data = await jsonLd(page);
  expect(data).toEqual([
    {
      "@context": "https://schema.org",
      "@type": "SportsTeam",
      name: "Joinable Browser Team",
      url: `${siteOrigin}/teams/joinable-browser-team`,
      description: "A browser-test team open to campus players.",
      sport: "Esports",
      parentOrganization: {
        "@type": "CollegeOrUniversity",
        name: "Browser Test University",
        url: `${siteOrigin}/schools/browser-test-university`,
      },
    },
  ]);
});

test("login, signup, and a profile are noindex with no canonical or structured data", async ({
  page,
}) => {
  for (const path of ["/login", "/signup", "/users/reportable-player"]) {
    await page.goto(path);

    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex,nofollow",
    );
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    await expect(
      page.locator('script[type="application/ld+json"]'),
    ).toHaveCount(0);
  }
});

test("a profile preview never names the person", async ({ page }) => {
  await page.goto("/users/reportable-player");

  const head = await page.locator("head").innerHTML();
  expect(head).not.toContain("Reportable Browser Player");
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    "content",
    "Player profile | Campus Gaming Network",
  );
});

test("a locked private event has a generic noindex preview with no event details", async ({
  page,
}) => {
  await page.goto("/events/private-browser-event");

  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    "noindex,nofollow",
  );
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    "content",
    "Private event | Campus Gaming Network",
  );
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(
    0,
  );
  const head = await page.locator("head").innerHTML();
  for (const secret of [
    "Invitation-Only Strategy Session",
    "Private Student Union Room",
    "123 Hidden Campus Way",
  ]) {
    expect(head).not.toContain(secret);
  }
});
