import { expect, test } from "@playwright/test";

const apiURL = "http://127.0.0.1:18081";
const siteOrigin = "http://127.0.0.1:3200";

const pages = [
  {
    path: "/about",
    title: "About",
    description:
      "How Campus Gaming Network connects collegiate gamers with events, teams, and campus activity.",
    heading: "Campus Gaming Network connects collegiate gaming communities."
  },
  {
    path: "/faq",
    title: "FAQ",
    description:
      "Answers to common questions about accounts, events, teams, and schools on Campus Gaming Network.",
    heading: "Frequently asked questions."
  },
  {
    path: "/privacy",
    title: "Privacy",
    description:
      "How Campus Gaming Network collects, uses, and protects your information.",
    heading: "Privacy placeholder"
  },
  {
    path: "/terms",
    title: "Terms",
    description: "The terms of service for using Campus Gaming Network.",
    heading: "Terms placeholder"
  },
  {
    path: "/support",
    title: "Support",
    description:
      "Get help with Campus Gaming Network or send the team a support request.",
    heading: "Need help?"
  }
] as const;

for (const expected of pages) {
  test(`${expected.path} SSRs with indexable metadata and no anonymous /me traffic`, async ({
    page,
    request
  }) => {
    const reset = await request.post(`${apiURL}/__test/reset`);
    expect(reset.ok()).toBe(true);

    const response = await page.goto(expected.path);

    expect(response?.status()).toBe(200);
    expect(response?.headers()["content-type"]).toContain("text/html");
    expect(response?.headers()["cache-control"]).toBe(
      "public, max-age=0, must-revalidate"
    );
    expect(response?.headers().vary).toContain("Cookie");
    await expect(page).toHaveTitle(
      `${expected.title} | Campus Gaming Network`
    );
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      expected.description
    );
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
      "content",
      `${siteOrigin}${expected.path}`
    );
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: expected.heading, level: 1 })
    ).toBeVisible();

    if (expected.path === "/faq") {
      const schoolQuestion = page.getByText("Can any school be listed?", {
        exact: true
      });
      await schoolQuestion.click();
      await expect(
        page.getByText(
          "Phase 1 starts with the seeded school list. Main and branch campuses are shown the same way."
        )
      ).toBeVisible();
    }

    if (expected.path === "/support") {
      await expect(
        page.getByRole("button", { name: "Submit support ticket" })
      ).toBeVisible();
      await expect(page.getByLabel("Email")).toBeVisible();
    }

    const upstreamResponse = await request.get(
      `${apiURL}/__test/upstream-calls`
    );
    expect(upstreamResponse.ok()).toBe(true);
    const upstream = (await upstreamResponse.json()) as {
      calls: Array<{ method: string; pathname: string }>;
    };
    expect(upstream.calls.filter((call) => call.pathname === "/me")).toEqual(
      []
    );
  });
}

test("static SSR stays viewer-neutral when a session cookie is present", async ({
  request
}) => {
  const reset = await request.post(`${apiURL}/__test/reset`);
  expect(reset.ok()).toBe(true);
  const login = await request.post(`${apiURL}/auth/login`, {
    data: {
      email: "static-session@example.test",
      password: "E2EPassword123!"
    }
  });
  expect(login.ok()).toBe(true);
  const cookie = login.headers()["set-cookie"]?.split(";", 1)[0];
  expect(cookie).toBeTruthy();

  const response = await request.get(`${siteOrigin}/about`, {
    headers: { cookie: cookie ?? "" }
  });
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe(
    "public, max-age=0, must-revalidate"
  );

  const upstreamResponse = await request.get(
    `${apiURL}/__test/upstream-calls`
  );
  const upstream = (await upstreamResponse.json()) as {
    calls: Array<{ method: string; pathname: string }>;
  };
  expect(upstream.calls.filter((call) => call.pathname === "/me")).toEqual(
    []
  );
});
