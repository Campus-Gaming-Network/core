import { expect, test } from "@playwright/test";
import { gotoApp } from "./fixtures/app-navigation.js";

const apiURL = "http://127.0.0.1:18081";

test.beforeEach(async ({ request }) => {
  const response = await request.post(`${apiURL}/__test/reset`);
  expect(response.ok()).toBe(true);
});

const shownNotices = [
  {
    path: "/events?event=rsvp-failed",
    role: "alert",
    message: "We could not save your RSVP. Please try again.",
  },
  {
    path: "/teams?team=join-failed",
    role: "alert",
    message: "We could not join that team. Please try again.",
  },
  {
    path: "/?account=deleted",
    role: "status",
    message: "Your account was deleted.",
  },
] as const;

for (const expected of shownNotices) {
  test(`${expected.path} shows its ${expected.role} notice`, async ({
    page,
  }) => {
    await gotoApp(page, expected.path);

    await expect(
      page.getByRole(expected.role).filter({ hasText: expected.message }),
    ).toBeVisible();
  });
}

test("pages render nothing for notices they do not produce", async ({
  page,
}) => {
  for (const path of [
    "/events?event=created",
    "/events?event=backend-message",
    "/events/public-browser-event?event=cancelled",
    "/teams?team=joined",
    "/schools?follow=added",
    "/?account=",
  ]) {
    await gotoApp(page, path);

    await expect(
      page.locator('main > p[aria-live="polite"]'),
      path,
    ).toHaveCount(0);
  }
});
