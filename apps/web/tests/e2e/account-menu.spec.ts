import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { logIn, logOut, waitForAppReady } from "./fixtures/app-navigation.js";

const apiURL = "http://127.0.0.1:18081";
const email = "player@example.test";
const viewerId = `user-${Buffer.from(email).toString("base64url")}`;

test.beforeEach(async ({ request }) => {
  const response = await request.post(`${apiURL}/__test/reset`);
  expect(response.ok()).toBe(true);
});

test("the account menu shows the viewer, opens, and closes from the keyboard and pointer", async ({
  page,
}) => {
  await logIn(page, email, "/events");
  const trigger = page.getByRole("button", { name: "account menu" });
  const menu = page.locator(".account-menu__panel");

  await expect(trigger).toHaveAccessibleName(
    "Browser Test Player, account menu",
  );
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".account-menu__name")).toHaveText("Browser");
  await expect(menu).toBeHidden();

  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(menu).toBeVisible();
  expect(
    await menu.locator("a, button").evaluateAll((items) =>
      items.map((item) => ({
        text: item.textContent,
        href: item.getAttribute("href"),
      })),
    ),
  ).toEqual([
    { text: "Account", href: "/account" },
    { text: "Public profile", href: `/users/${viewerId}` },
    { text: "Log out", href: null },
  ]);

  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");

  await page.keyboard.press("Enter");
  await expect(menu).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(menu.getByRole("link", { name: "Account" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    menu.getByRole("link", { name: "Public profile" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(menu.getByRole("button", { name: "Log out" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(menu).toBeHidden();

  await trigger.click();
  await expect(menu).toBeVisible();
  await trigger.click();
  await expect(menu).toBeHidden();

  await trigger.click();
  await expect(menu).toBeVisible();
  await page
    .getByRole("contentinfo")
    .getByText("Campus Gaming Network")
    .click();
  await expect(menu).toBeHidden();
});

test("choosing a menu link closes the menu, on the same page and on a new one", async ({
  page,
}) => {
  await logIn(page, email, "/account");
  const trigger = page.getByRole("button", { name: "account menu" });
  const menu = page.locator(".account-menu__panel");

  await trigger.click();
  const account = menu.getByRole("link", { name: "Account" });
  await expect(account).toHaveAttribute("aria-current", "page");
  await account.click();
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await menu.getByRole("link", { name: "Public profile" }).click();
  await expect(page).toHaveURL(new RegExp(`/users/${viewerId}$`));
  await waitForAppReady(page);
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(menu).toBeHidden();
});

test("Log out in the account menu ends the session", async ({
  context,
  page,
}) => {
  await logIn(page, email, "/events");

  await logOut(page);

  await expect(page).toHaveURL(/\/$/);
  await waitForAppReady(page);
  await expect(page.getByRole("link", { name: "Log in" })).toBeVisible();
  await expect(page.locator(".account-menu")).toHaveCount(0);
  await expect
    .poll(async () =>
      (await context.cookies()).some((cookie) => cookie.name === "cgn_session"),
    )
    .toBe(false);
});

test("a failed logout reports the problem inside the open menu and can be retried", async ({
  page,
}) => {
  await logIn(page, email, "/events");
  const menu = page.locator(".account-menu__panel");
  await page.getByRole("button", { name: "account menu" }).click();
  const action = await menu.locator("form").getAttribute("action");
  const logoutURL = new URL(action ?? "", page.url()).href;
  const isLogoutRequest = (url: URL) => url.href === logoutURL;

  await page.route(isLogoutRequest, (route) => route.abort());
  await menu.getByRole("button", { name: "Log out" }).click();

  await expect(menu.getByRole("alert")).toHaveText(
    "We could not log you out. Please try again.",
  );
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("button", { name: "Log out" })).toBeEnabled();

  await page.unroute(isLogoutRequest);
  await menu.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("link", { name: "Log in" })).toBeVisible();
});

test("the open account menu has no accessibility violations", async ({
  page,
}) => {
  await logIn(page, email, "/account");
  await page.getByRole("button", { name: "account menu" }).click();
  await expect(page.locator(".account-menu__panel")).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();

  expect(
    results.violations.map((violation) => ({
      id: violation.id,
      targets: violation.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
});

test("on phones the menu takes the primary-action slot and the nav keeps three cells", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  await logIn(page, email, "/events");
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  const trigger = navigation.getByRole("button", { name: "account menu" });
  await expect(trigger).toBeVisible();

  const cells = navigation.locator(":scope > a");
  const widths = await cells.evaluateAll((links) =>
    links.map((link) => Math.round(link.getBoundingClientRect().width)),
  );
  const triggerBox = await trigger.boundingBox();
  const firstCellBox = await cells.first().boundingBox();
  expect(widths).toHaveLength(3);
  expect(new Set(widths).size).toBe(1);
  expect(triggerBox).not.toBeNull();
  expect(firstCellBox).not.toBeNull();
  // The trigger sits on the brand's row, above the row of links.
  expect((triggerBox?.y ?? 0) + (triggerBox?.height ?? 0)).toBeLessThanOrEqual(
    (firstCellBox?.y ?? 0) + 1,
  );
  expect(triggerBox?.height).toBeGreaterThanOrEqual(43.5);

  await trigger.click();
  const itemHeights = await page
    .locator(".account-menu__panel")
    .locator("a, button")
    .evaluateAll((items) =>
      items.map((item) => item.getBoundingClientRect().height),
    );
  expect(itemHeights).toHaveLength(3);
  for (const height of itemHeights) {
    expect(height).toBeGreaterThanOrEqual(43.5);
  }
});
