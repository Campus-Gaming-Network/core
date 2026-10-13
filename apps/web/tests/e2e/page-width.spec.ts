import { expect, test, type Page } from "@playwright/test";
import { gotoApp, logIn } from "./fixtures/app-navigation.js";

const apiURL = "http://127.0.0.1:18081";

const publicPaths = [
  "/",
  "/about",
  "/faq",
  "/support",
  "/terms",
  "/privacy",
  "/events",
  "/events/public-browser-event",
  "/schools",
  "/teams",
  "/login",
  "/signup",
  "/styleguide",
];
const signedInPaths = ["/account", "/events/new", "/teams/new"];

interface Geometry {
  x: number;
  width: number;
  overflowsHorizontally: boolean;
}

async function measureMain(page: Page): Promise<Geometry> {
  const box = await page.locator("main").boundingBox();
  if (!box) throw new Error(`no <main> box at ${page.url()}`);
  const overflowsHorizontally = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );
  return { x: box.x, width: box.width, overflowsHorizontally };
}

test.beforeEach(async ({ request }) => {
  const response = await request.post(`${apiURL}/__test/reset`);
  expect(response.ok()).toBe(true);
});

test("every top-level page has the same content width and left edge", async ({
  page,
}) => {
  const measured: Record<string, Geometry> = {};
  for (const path of publicPaths) {
    await gotoApp(page, path);
    measured[path] = await measureMain(page);
  }
  await logIn(page, "player@example.test", signedInPaths[0]);
  measured[signedInPaths[0]] = await measureMain(page);
  for (const path of signedInPaths.slice(1)) {
    await gotoApp(page, path);
    measured[path] = await measureMain(page);
  }

  const reference = measured["/"];
  expect(measured).toEqual(
    Object.fromEntries(
      [...publicPaths, ...signedInPaths].map((path) => [
        path,
        { ...reference, overflowsHorizontally: false },
      ]),
    ),
  );
});
