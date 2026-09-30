import { expect, test } from "@playwright/test";
import { gotoApp } from "./fixtures/app-navigation.js";

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
