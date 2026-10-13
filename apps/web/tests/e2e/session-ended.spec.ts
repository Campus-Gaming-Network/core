import { expect, test } from "@playwright/test";
import { logIn, waitForAppReady } from "./fixtures/app-navigation.js";

const apiURL = "http://127.0.0.1:18081";

test.beforeEach(async ({ request }) => {
  const response = await request.post(`${apiURL}/__test/reset`);
  expect(response.ok()).toBe(true);
});

test("a session ended on the server signs the open page out", async ({
  context,
  page,
  request,
}) => {
  await logIn(page, "session-ended@example.test", "/teams/new");
  await page.getByLabel("Team name").fill("Signed Out Team");
  await page.getByRole("checkbox", { name: "Strategy Arena" }).check();
  await page.getByLabel("Join password").fill("BrowserTeamPass123!");

  const revoked = await request.post(`${apiURL}/__test/revoke-sessions`);
  expect(revoked.ok()).toBe(true);
  await page.getByRole("button", { name: "Create team" }).click();

  // The page needs an account, so once it knows the session is gone it sends
  // the visitor to log in.
  await expect(page).toHaveURL("/login?next=%2Fteams%2Fnew");
  await waitForAppReady(page);
  await expect(
    page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", {
        name: "Log in",
      }),
  ).toBeVisible();
  expect(
    (await context.cookies()).filter(({ name }) => name === "cgn_session"),
  ).toEqual([]);
});
