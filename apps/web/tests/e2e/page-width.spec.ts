import { expect, test, type Page } from "@playwright/test";
import { gotoApp, logIn } from "./fixtures/app-navigation.js";

const apiURL = "http://127.0.0.1:18081";

// Pages whose visible content spans the whole content width.
const fillPaths = [
  "/",
  "/events",
  "/events/public-browser-event",
  "/schools",
  "/teams",
  "/login",
  "/signup",
];
const signedInFillPaths = [
  "/account",
  "/settings/profile",
  "/events/new",
  "/teams/new",
];
// Running text keeps a readable measure, so only its left edge is compared.
const prosePaths = ["/about", "/faq", "/support", "/terms", "/privacy"];

interface Geometry {
  x: number;
  width: number;
  left: number;
  right: number | undefined;
  overflowsHorizontally: boolean;
}

// Measures <main> and the union of its visible direct children, which is the
// content a person sees.
async function measureMain(page: Page): Promise<Geometry> {
  const box = await page.locator("main").boundingBox();
  if (!box) throw new Error(`no <main> box at ${page.url()}`);
  const content = await page.locator("main").evaluate((main) => {
    const rects = Array.from(main.children, (child) =>
      child.getBoundingClientRect(),
    ).filter((rect) => rect.width > 0 && rect.height > 0);
    return {
      left: Math.min(...rects.map((rect) => rect.left)),
      right: Math.max(...rects.map((rect) => rect.right)),
      overflowsHorizontally:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    };
  });
  return { x: box.x, width: box.width, ...content };
}

test.beforeEach(async ({ request }) => {
  const response = await request.post(`${apiURL}/__test/reset`);
  expect(response.ok()).toBe(true);
});

test("every top-level page has the same content width and left edge", async ({
  page,
}) => {
  const measured: Record<string, Geometry> = {};
  for (const path of [...fillPaths, ...prosePaths]) {
    await gotoApp(page, path);
    measured[path] = await measureMain(page);
  }
  await logIn(page, "player@example.test", signedInFillPaths[0]);
  measured[signedInFillPaths[0]] = await measureMain(page);
  for (const path of signedInFillPaths.slice(1)) {
    await gotoApp(page, path);
    measured[path] = await measureMain(page);
  }

  // Prose keeps its own right edge; drop it before comparing.
  for (const path of prosePaths) measured[path].right = undefined;

  const reference = measured["/"];
  expect(measured).toEqual(
    Object.fromEntries(
      Object.keys(measured).map((path) => [
        path,
        {
          ...reference,
          right: prosePaths.includes(path) ? undefined : reference.right,
          overflowsHorizontally: false,
        },
      ]),
    ),
  );
});
