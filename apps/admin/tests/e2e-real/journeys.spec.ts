import { expect, test } from "@playwright/test";
import { accessAssertion, signInThroughAccess } from "./fixtures/access.js";
import { panel, runCommand, signInSteppedUp } from "./fixtures/console.js";

const apiURL = "http://127.0.0.1:18090";
const primarySchoolID = "10000000-0000-4000-8000-000000000001";
const gameID = "20000000-0000-4000-8000-000000000001";
const peerEmail = "peer@admin-real.test";
const peerID = "30000000-0000-4000-8000-000000000002";
const memberID = "30000000-0000-4000-8000-000000000003";

// The journeys sign in as their own site admin. Admin API reads are limited
// per operator, and the security suite's operator needs its own budget.
const operatorEmail = "journeys@admin-real.test";
const operatorID = "30000000-0000-4000-8000-000000000011";
const reportID = "40000000-0000-4000-8000-000000000001";
const supportTicketID = "40000000-0000-4000-8000-000000000002";

test("journey 1: an Access-authenticated site admin triages a report and sees its audit history", async ({
  context,
  page,
}) => {
  await signInThroughAccess(context, operatorEmail);
  // A first deep link exchanges the Access assertion and loads the page in the
  // same request.
  await page.goto(`/reports/${reportID}`);
  await expect(page.getByText("<img src=x", { exact: false })).toBeVisible();

  await page.getByLabel("Status").selectOption("resolved");
  await page.getByLabel("Assignee").selectOption(operatorID);
  await page.getByLabel("Resolution note").fill("Warned the account holder");
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page).toHaveURL(/notice=updated/);
  await expect(page.getByRole("status")).toHaveText("Changes saved.");
  await expect(page.getByText("Report updated")).toBeVisible();
  await expect(page.getByLabel("Status")).toHaveValue("resolved");
});

test("journey 2: a support ticket with hostile markup stays inert text", async ({
  context,
  page,
}) => {
  await signInThroughAccess(context, operatorEmail);
  await page.goto(`/support-tickets/${supportTicketID}`);
  await expect(page.getByText("<svg onload=", { exact: false })).toBeVisible();
  await expect(page.locator("main svg")).toHaveCount(0);

  await page.getByLabel("Status").selectOption("resolved");
  await page.getByLabel("Assignee").selectOption(operatorID);
  await page.getByLabel("Resolution note").fill("Helped the member sign in");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toHaveText("Changes saved.");
  expect(await page.locator("body").getAttribute("data-xss")).toBeNull();
});

async function publicSchoolNames(
  request: Parameters<Parameters<typeof test>[2]>[0]["request"],
  query: string,
): Promise<string[]> {
  const response = await request.get(`${apiURL}/schools?q=${query}`);
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { schools: { name: string }[] };
  return body.schools.map((school) => school.name);
}

test("journey 3: catalog changes reach the public school list", async ({
  context,
  page,
  request,
}) => {
  await signInThroughAccess(context, operatorEmail);
  await page.goto("/schools/new");
  await page.getByLabel("Name").fill("Night Owl College");
  await page.getByLabel("Slug").fill("night-owl-college");
  await page.getByLabel("Reason").fill("New member school");
  await page.getByRole("button", { name: "Create school" }).click();
  await expect(page).toHaveURL(/\/schools\/[0-9a-f-]{36}\?notice=created$/);
  expect(await publicSchoolNames(request, "Night")).toEqual([
    "Night Owl College",
  ]);

  const edit = panel(page, "Edit school");
  await edit.getByLabel("Name").fill("Night Owl University");
  await edit.getByLabel("Reason").fill("Official name");
  await edit.getByRole("button", { name: "Save school" }).click();
  await expect(page).toHaveURL(/notice=saved$/);
  expect(await publicSchoolNames(request, "Night")).toEqual([
    "Night Owl University",
  ]);

  await runCommand(
    panel(page, "Deactivate"),
    "Closed for the season",
    "Deactivate school",
  );
  await expect(page.getByRole("status")).toHaveText("School deactivated.");
  expect(await publicSchoolNames(request, "Night")).toEqual([]);

  await runCommand(panel(page, "Reactivate"), "Reopened", "Reactivate school");
  await expect(page.getByRole("status")).toHaveText("Reactivated.");
  expect(await publicSchoolNames(request, "Night")).toEqual([
    "Night Owl University",
  ]);
});

test("journey 4: school-admin role indicators follow the active grant", async ({
  context,
  page,
  request,
}) => {
  const roleIndicators = async () => {
    const response = await request.get(`${apiURL}/users/${memberID}`);
    expect(response.ok()).toBe(true);
    const body = (await response.json()) as { role_indicators?: string[] };
    return body.role_indicators ?? [];
  };
  expect(await roleIndicators()).toEqual([]);

  await signInThroughAccess(context, operatorEmail);
  await page.goto(`/schools/${primarySchoolID}`);
  const grant = panel(page, "Grant school-admin access");
  await grant.getByLabel("User email").fill("member@admin-real.test");
  await runCommand(grant, "Esports coordinator", "Grant access");
  await expect(page.getByRole("status")).toHaveText(
    "School-admin access granted.",
  );
  expect(await roleIndicators()).toEqual(["school_admin"]);

  const memberGrant = page
    .getByRole("listitem")
    .filter({ has: page.locator(`a[href="/users/${memberID}"]`) });
  await runCommand(
    memberGrant.getByRole("region", { name: "Revoke", exact: true }),
    "Left the role",
    "Revoke access",
  );
  await expect(page.getByRole("status")).toHaveText(
    "School-admin access revoked.",
  );
  expect(await roleIndicators()).toEqual([]);
});

test("journey 5: a valid logo uploads and invalid files are refused", async ({
  context,
  page,
}) => {
  await signInThroughAccess(context, operatorEmail);
  await page.goto(`/schools/${primarySchoolID}`);
  const logo = panel(page, "Logo");
  const file = logo.getByLabel("Logo file");

  await file.setInputFiles({
    name: "huge.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
  });
  await expect(file).toHaveAttribute("aria-invalid", "true");

  await file.setInputFiles({
    name: "logo.png",
    mimeType: "image/png",
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
  });
  await logo.getByLabel("Reason").fill("Official logo");
  await logo.getByRole("button", { name: "Upload logo" }).click();
  await expect(logo.getByRole("alert")).toContainText("PNG or JPEG");

  await file.setInputFiles({
    name: "logo.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64",
    ),
  });
  await logo.getByRole("button", { name: "Upload logo" }).click();
  await expect(page).toHaveURL(/notice=logo-updated$/);
  const preview = logo.getByRole("img", { name: "Real Stack University logo" });
  await expect
    .poll(() =>
      preview.evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBe(1);

  await runCommand(
    panel(page, "Remove logo"),
    "Rebrand pending",
    "Remove logo",
  );
  await expect(page.getByRole("status")).toHaveText(
    "Logo removed. The school shows the placeholder again.",
  );
  await expect(logo.getByRole("img")).toHaveCount(0);
});

test("journey 6: a stale second browser receives a conflict", async ({
  browser,
  context,
  page,
}) => {
  await signInThroughAccess(context, operatorEmail);
  await page.goto(`/games/${gameID}`);

  const otherContext = await browser.newContext();
  await signInThroughAccess(otherContext, operatorEmail);
  const otherPage = await otherContext.newPage();
  await otherPage.goto(`/games/${gameID}`);

  const first = panel(page, "Edit game");
  await first.getByLabel("Name").fill("Strategy Arena Deluxe");
  await first.getByLabel("Reason").fill("Retitled");
  await first.getByRole("button", { name: "Save game" }).click();
  await expect(page).toHaveURL(/notice=saved$/);

  const stale = panel(otherPage, "Edit game");
  await stale.getByLabel("Name").fill("Strategy Arena Classic");
  await stale.getByLabel("Reason").fill("Competing edit");
  await stale.getByRole("button", { name: "Save game" }).click();
  await expect(stale.getByRole("alert")).toContainText(
    "This record changed after you opened it",
  );
  await expect(stale.getByLabel("Name")).toHaveValue("Strategy Arena Classic");
  await otherContext.close();
});

test("journey 7: revoking a site admin ends their open session at once", async ({
  browser,
  context,
  page,
}) => {
  await signInSteppedUp(context, page, operatorEmail);
  await page.goto(`/users/${peerID}`);
  await runCommand(
    panel(page, "Site-admin access"),
    "Second operator",
    "Grant site-admin access",
  );
  await expect(page.getByRole("status")).toBeVisible();

  const peerContext = await browser.newContext();
  await signInThroughAccess(peerContext, peerEmail);
  const peerPage = await peerContext.newPage();
  await peerPage.goto("/reports");
  await expect(
    peerPage.getByRole("heading", { name: "Reports", exact: true }),
  ).toBeVisible();

  await page.goto("/access/site-admins");
  const peerGrant = page
    .getByRole("listitem")
    .filter({ has: page.locator(`a[href="/users/${peerID}"]`) });
  await runCommand(
    peerGrant.getByRole("region", { name: "Revoke access" }),
    "Rotating operators",
    "Revoke site-admin access",
  );
  await expect(page.getByRole("status")).toBeVisible();

  // The peer's browser still holds its session cookies and Access assertion.
  await peerPage.goto("/reports");
  await expect(
    peerPage.getByRole("heading", { name: "Reports", exact: true }),
  ).toHaveCount(0);
  await expect(
    peerPage.getByRole("navigation", { name: "Admin navigation" }),
  ).toHaveCount(0);
  await peerContext.close();
});

const adminProxySecret = "real-e2e-admin-proxy-secret-0000000";
const publicProxySecret = "real-e2e-proxy-secret-000000000000";
const adminOrigin = "http://127.0.0.1:3310";

// What every rejected request must avoid revealing.
const protectedMarkers = [
  "operator@admin-real.test",
  "Real Stack University",
  "abusive display name",
];

async function expectNoProtectedContent(response: { text(): Promise<string> }) {
  const body = await response.text();
  for (const marker of protectedMarkers) {
    expect(body).not.toContain(marker);
  }
}

test("journey 8: direct-origin, public-cookie, and forged requests fail closed", async ({
  browser,
  request,
}) => {
  const session = `${apiURL}/admin/v1/session`;
  // No proxy credential, the public site's credential, and a browser-set
  // header are all refused before any session logic runs.
  const directHeaders: Record<string, string>[] = [
    {},
    { "X-CGN-Proxy-Secret": publicProxySecret },
    { "X-CGN-Admin-Proxy-Secret": publicProxySecret },
    { "X-CGN-Admin-Proxy-Secret": "" },
  ];
  await Promise.all(
    directHeaders.map(async (headers) => {
      const response = await request.get(session, { headers });
      expect([401, 403, 404]).toContain(response.status());
      await expectNoProtectedContent(response);
    }),
  );
  // The admin credential without a session is unauthenticated.
  const anonymous = await request.get(session, {
    headers: { "X-CGN-Admin-Proxy-Secret": adminProxySecret },
  });
  expect(anonymous.status()).toBe(401);

  // A public `cgn_session` cookie alone never creates an admin principal. With
  // no Access assertion the request is refused before anything renders.
  const publicContext = await browser.newContext();
  await publicContext.addCookies([
    {
      name: "cgn_session",
      value: "a".repeat(43),
      domain: "127.0.0.1",
      path: "/",
    },
  ]);
  const publicPage = await publicContext.newPage();
  const refused = await publicPage.goto("/reports");
  expect(refused?.status()).toBe(403);
  await expect(publicPage.locator("body")).toBeEmpty();
  await publicContext.close();

  // A revoked grant, a school admin, and an ordinary member all pass Access
  // yet receive no admin session.
  await Promise.all(
    [
      "former@admin-real.test",
      "schooladmin@admin-real.test",
      "member@admin-real.test",
    ].map(async (email) => {
      const context = await browser.newContext();
      await signInThroughAccess(context, email);
      const page = await context.newPage();
      await page.goto("/reports");
      await expect(
        page.getByRole("navigation", { name: "Admin navigation" }),
      ).toHaveCount(0);
      expect(
        (await context.cookies()).filter((cookie) =>
          cookie.name.startsWith("cgn_admin"),
        ),
      ).toEqual([]);
      await context.close();
    }),
  );

  // A cross-site form post to the step-up endpoint is refused.
  const forgedPosts: Record<string, string>[] = [
    { "sec-fetch-site": "cross-site", origin: "https://evil.example" },
    { origin: "https://admin.campusgamingnetwork.com.evil.example" },
    { origin: "null" },
  ];
  await Promise.all(
    forgedPosts.map(async (headers) => {
      const response = await request.post(`${adminOrigin}/step-up`, {
        headers,
        form: { return: "/" },
      });
      expect(response.status()).toBe(403);
    }),
  );
});

test("journey 8: an established session rejects forged origins and missing CSRF", async ({
  request,
}) => {
  const headers = { "X-CGN-Admin-Proxy-Secret": adminProxySecret };
  const exchange = await request.post(`${apiURL}/admin/v1/auth/exchange`, {
    headers: {
      ...headers,
      Origin: adminOrigin,
      "Cf-Access-Jwt-Assertion": accessAssertion(operatorEmail),
    },
  });
  expect(exchange.status()).toBe(201);
  const cookies = exchange
    .headersArray()
    .filter((header) => header.name.toLowerCase() === "set-cookie")
    .map((header) => header.value.split(";")[0]);
  const csrf = cookies
    .find((cookie) => cookie.startsWith("cgn_admin_csrf="))
    ?.split("=")[1];
  const cookieHeader = cookies.join("; ");
  const target = `${apiURL}/admin/v1/reports/${reportID}`;
  const body = {
    status: "closed",
    expected_updated_at: "2000-01-01T00:00:00Z",
  };

  const forgedRequests: Record<string, string>[] = [
    { Origin: "https://evil.example", "X-CGN-Admin-CSRF": csrf ?? "" },
    { Origin: `${adminOrigin}.evil.example`, "X-CGN-Admin-CSRF": csrf ?? "" },
    { "X-CGN-Admin-CSRF": csrf ?? "" },
    { Origin: adminOrigin },
    { Origin: adminOrigin, "X-CGN-Admin-CSRF": "not-the-token" },
  ];
  await Promise.all(
    forgedRequests.map(async (forged) => {
      const response = await request.patch(target, {
        headers: {
          ...headers,
          "X-CGN-Admin-Access-Email": operatorEmail,
          Cookie: cookieHeader,
          ...forged,
        },
        data: body,
      });
      expect(response.status()).toBe(403);
    }),
  );

  // A stale or unknown assertion is refused at exchange, and no cookie is set.
  await Promise.all(
    ["not-a-jwt", accessAssertion(operatorEmail, { keyID: "unknown-key" })].map(
      async (assertion) => {
        const response = await request.post(
          `${apiURL}/admin/v1/auth/exchange`,
          {
            headers: {
              ...headers,
              Origin: adminOrigin,
              "Cf-Access-Jwt-Assertion": assertion,
            },
          },
        );
        expect(response.status()).toBe(401);
        expect(
          response
            .headersArray()
            .filter((header) => header.name.toLowerCase() === "set-cookie"),
        ).toEqual([]);
      },
    ),
  );
});
