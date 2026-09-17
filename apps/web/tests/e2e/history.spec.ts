import { expect, test, type Page } from "@playwright/test";
import { gotoApp, logIn, waitForAppReady } from "./fixtures/app-navigation.js";

const apiURL = "http://127.0.0.1:18081";

test.beforeEach(async ({ request }) => {
  const response = await request.post(`${apiURL}/__test/reset`);
  expect(response.ok()).toBe(true);
});

test("back and forward preserve filtered team catalog navigation", async ({
  page,
}) => {
  await gotoApp(page, "/teams");
  await page.getByLabel("Filter teams by game").selectOption("strategy-arena");
  await page.getByLabel("School slug").fill("browser-test-university");
  await page.getByRole("button", { name: "Filter" }).click();

  await expectCatalogSearch(page);
  await expect(
    page.getByRole("link", { name: /Joinable Browser Team/ }),
  ).toBeVisible();

  await page.getByRole("link", { name: /Joinable Browser Team/ }).click();
  await expect(page).toHaveURL(/\/teams\/joinable-browser-team$/);
  await expect(
    page.getByRole("heading", { name: "Joinable Browser Team", level: 1 }),
  ).toBeVisible();

  await page.goBack();
  await expectCatalogSearch(page);
  await expect(page.getByLabel("Filter teams by game")).toHaveValue(
    "strategy-arena",
  );
  await expect(page.getByLabel("School slug")).toHaveValue(
    "browser-test-university",
  );
  await expect(
    page.getByRole("link", { name: /Joinable Browser Team/ }),
  ).toBeVisible();

  await page.goForward();
  await expect(page).toHaveURL(/\/teams\/joinable-browser-team$/);
  await expect(
    page.getByRole("heading", { name: "Joinable Browser Team", level: 1 }),
  ).toBeVisible();
});

test("follow redirect replaces the mutation page without repeating the POST", async ({
  page,
}) => {
  await logIn(
    page,
    "history-player@example.test",
    "/schools/follow-browser-university",
  );
  await gotoApp(page, "/schools");
  await gotoApp(page, "/schools/follow-browser-university");

  await page.getByRole("button", { name: "Follow school" }).click();
  await expect(page).toHaveURL(
    /\/schools\/follow-browser-university\?follow=added$/,
  );
  await expect(page.getByText("School followed.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Unfollow" })).toBeVisible();
  await expectFollowPostCount(page, 1);
  await waitForAppReady(page);

  await page.goBack();
  await expect(page).toHaveURL(/\/schools$/);
  await waitForAppReady(page);
  await expect(
    page.getByRole("heading", { name: "Browse schools", level: 1 }),
  ).toBeVisible();

  await page.goForward();
  await expect(page).toHaveURL(
    /\/schools\/follow-browser-university\?follow=added$/,
  );
  await waitForAppReady(page);
  await expect(page.getByText("School followed.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Unfollow" })).toBeVisible();
  await expectFollowPostCount(page, 1);
});

async function expectCatalogSearch(page: Page) {
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === "/teams" &&
      url.searchParams.get("game") === "strategy-arena" &&
      url.searchParams.get("school") === "browser-test-university",
  );
}

async function expectFollowPostCount(page: Page, expected: number) {
  await expect
    .poll(async () => {
      const response = await page.request.get(
        `${apiURL}/__test/upstream-calls`,
      );
      expect(response.ok()).toBe(true);
      const payload = (await response.json()) as {
        calls: Array<{ method: string; pathname: string }>;
      };
      return payload.calls.filter(
        (call) =>
          call.method === "POST" &&
          call.pathname === "/schools/school-follow-e2e/follow",
      ).length;
    })
    .toBe(expected);
}
