import { expect, test } from "@playwright/test";
import { gotoApp, waitForAppReady } from "./fixtures/app-navigation.js";

const apiURL = "http://127.0.0.1:18081";

test("school logos load from the asset origin under the page's image policy", async ({
  page,
  request,
}) => {
  const policy = (await request.get("/schools")).headers()[
    "content-security-policy"
  ];
  expect(policy).toContain(`img-src 'self' data: ${apiURL}`);

  await gotoApp(page, "/schools");
  const listLogo = page.getByRole("link", { name: /Browser Test University/ });
  const image = listLogo.locator("img");
  await expect(image).toHaveAttribute("src", /\/assets\/school-logos\//);
  await expect
    .poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth))
    .toBe(1);

  await gotoApp(page, "/schools/follow-browser-university");
  await expect(
    page.getByRole("img", { name: "Follow Browser University logo" }),
  ).toBeVisible();
});

test("bundled institutional logos load from the asset origin and carry source/license credits", async ({
  page,
  request,
}) => {
  await gotoApp(page, "/schools?q=logo-coverage");
  // A wordmark is unreadable in the square directory mark, so the card keeps
  // the initial and the school page shows the logo in a wider one.
  const card = page.getByRole("link", { name: /Alabama State University/ });
  await expect(card.locator("img")).toHaveCount(0);
  await expect(card.locator(".school-directory-mark")).toHaveText("A");
  const missing = page.getByRole("link", { name: /Quiet Valley College/ });
  await expect(missing.locator("img")).toHaveCount(0);
  await expect(missing.locator(".school-directory-mark")).toHaveText("Q");
  await card.click();
  await waitForAppReady(page);
  const image = page.getByRole("img", {
    name: "Alabama State University logo",
  });
  await expect(image).toHaveAttribute(
    "src",
    /\/assets\/bundled\/school-logos\/100724-/,
  );
  await expect
    .poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth))
    .toBeGreaterThan(0);
  await expect(
    page.getByRole("link", { name: "Source", exact: true }),
  ).toHaveAttribute("href", /^https:\/\/en\.wikipedia\.org\/wiki\/File:/);
  const credits = page.getByRole("link", { name: "All school logo credits" });
  const response = await request.get((await credits.getAttribute("href"))!);
  expect(response.ok()).toBe(true);
  expect(await response.text()).toContain("Alabama State University");
});

test("failed images reveal the initial and a later school logo still loads", async ({
  page,
}) => {
  await page.route("**/assets/school-logos/**", (route) => route.abort());
  await gotoApp(page, "/schools");
  const failed = page.getByRole("link", { name: /Browser Test University/ });
  await expect(failed.locator("img")).toHaveCount(0);
  await expect(failed.locator(".school-directory-mark")).toHaveText("B");
  await gotoApp(page, "/schools/alabama-state-university");
  const image = page.getByRole("img", {
    name: "Alabama State University logo",
  });
  await expect
    .poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth))
    .toBeGreaterThan(0);
});
