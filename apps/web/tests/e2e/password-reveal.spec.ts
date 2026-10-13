import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { gotoApp, logIn } from "./fixtures/app-navigation.js";

const apiURL = "http://127.0.0.1:18081";
const secret = "RevealMe123!";

test.beforeEach(async ({ request }) => {
  const response = await request.post(`${apiURL}/__test/reset`);
  expect(response.ok()).toBe(true);
});

for (const fixture of [
  {
    name: "team creation",
    path: "/teams/new",
    label: "Join password",
    signedInAs: "reveal-owner@example.test",
  },
  {
    name: "team join",
    path: "/teams/joinable-browser-team",
    label: "Team password",
    signedInAs: "reveal-member@example.test",
  },
  {
    name: "event form",
    path: "/events/new",
    label: "Private event password",
    signedInAs: "reveal-organizer@example.test",
  },
  {
    name: "event unlock",
    path: "/events/private-reveal",
    label: "Event password",
  },
]) {
  test(`${fixture.name} password can be shown and hidden`, async ({ page }) => {
    if (fixture.signedInAs) {
      await logIn(page, fixture.signedInAs, fixture.path);
    } else {
      await gotoApp(page, fixture.path);
    }
    const field = page.getByLabel(fixture.label, { exact: true });
    await field.fill(secret);
    await expect(field).toHaveAttribute("type", "password");

    await page.getByRole("button", { name: "Show password" }).click();
    // The same button stays focused and the field keeps what was typed.
    await expect(
      page.getByRole("button", { name: "Hide password" }),
    ).toBeFocused();
    await expect(field).toHaveAttribute("type", "text");
    await expect(field).toHaveValue(secret);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    await page.getByRole("button", { name: "Hide password" }).click();
    await expect(
      page.getByRole("button", { name: "Show password" }),
    ).toBeFocused();
    await expect(field).toHaveAttribute("type", "password");
    await expect(field).toHaveValue(secret);
    // The toggle is not a submit button, so the page has not navigated.
    await expect(page).toHaveURL(new RegExp(`${fixture.path}$`));
  });
}

test("a revealed event unlock password still submits", async ({ page }) => {
  const slug = "private-reveal";
  await gotoApp(page, `/events/${slug}`);
  await page.getByLabel("Event password").fill("E2EEventPassword123!");
  await page.getByRole("button", { name: "Show password" }).click();
  await page.getByRole("button", { name: "Unlock event" }).click();
  await expect(page).toHaveURL(`/events/${slug}?event=unlocked`);
});
