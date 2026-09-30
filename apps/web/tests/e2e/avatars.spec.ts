import { expect, test, type Page } from "@playwright/test";
import { gotoApp, logIn } from "./fixtures/app-navigation.js";

const siteOrigin = "http://127.0.0.1:3200";

// Collects every address the page asks a browser to fetch.
function requestedOrigins(page: Page): Set<string> {
  const origins = new Set<string>();
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol === "http:" || url.protocol === "https:") {
      origins.add(url.origin);
    }
  });
  return origins;
}

async function expectDrawnAvatar(page: Page) {
  const image = page.locator(".avatar img");
  await expect(image).toHaveAttribute(
    "src",
    /^\/api\/avatars\/[A-Za-z0-9_-]+$/,
  );
  await expect
    .poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth))
    .toBeGreaterThan(0);
}

test("a public profile shows an avatar this site draws and contacts no avatar service", async ({
  page,
}) => {
  const origins = requestedOrigins(page);

  await gotoApp(page, "/users/reportable-player");

  await expectDrawnAvatar(page);
  expect([...origins]).toEqual([siteOrigin]);
});

test("the account page does the same", async ({ page }) => {
  await logIn(page, "player@example.test", "/account");
  const origins = requestedOrigins(page);

  await gotoApp(page, "/account");

  await expectDrawnAvatar(page);
  expect([...origins]).toEqual([siteOrigin]);
});

test("the avatar route serves a cacheable sandboxed image and refuses what it should", async ({
  request,
}) => {
  const id = "5b0e7f5c-3f4d-4d8e-9a71-6c2b1e0f9d34";

  const avatar = await request.get(`/api/avatars/${id}`);
  expect(avatar.status()).toBe(200);
  expect(avatar.headers()["content-type"]).toBe("image/svg+xml; charset=utf-8");
  expect(avatar.headers()["cache-control"]).toContain("public, max-age=86400");
  expect(avatar.headers()["content-security-policy"]).toContain("sandbox");
  expect(await avatar.text()).toMatch(/^<svg /);

  const head = await request.head(`/api/avatars/${id}`);
  expect(head.status()).toBe(200);
  expect((await request.get(`/api/avatars/${"a".repeat(65)}`)).status()).toBe(
    404,
  );
  expect((await request.get("/api/avatars/not%20an%20id")).status()).toBe(404);
  const post = await request.post(`/api/avatars/${id}`, { data: "" });
  expect(post.status()).toBe(405);
});
