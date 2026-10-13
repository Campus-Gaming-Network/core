import { expect, test } from "@playwright/test";
import { gotoApp } from "./fixtures/app-navigation.js";

test("a profile shows its home school's logo beside the linked school name", async ({
  page,
}) => {
  await gotoApp(page, "/users/bundled-logo-player");

  const schoolLink = page.getByRole("link", { name: "Alabama A&M University" });
  const image = schoolLink.locator("img");
  await expect(image).toHaveAttribute(
    "src",
    /\/assets\/bundled\/school-logos\/100654-/,
  );
  await expect
    .poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth))
    .toBeGreaterThan(0);
  // The name already says which school this is, so the image is decorative.
  expect(
    await image.evaluate((node: HTMLImageElement) => ({
      alt: node.getAttribute("alt"),
      width: node.width,
      height: node.height,
    })),
  ).toEqual({ alt: "", width: 20, height: 20 });
  await expect(schoolLink).toHaveAttribute(
    "href",
    "/schools/alabama-a-m-university",
  );
});

test("a profile whose home school has no logo shows only the linked name", async ({
  page,
}) => {
  await gotoApp(page, "/users/reportable-player");

  const schoolLink = page
    .getByRole("region", { name: "Profile details" })
    .getByRole("link");
  await expect(schoolLink).toHaveText("Browser Test University");
  await expect(schoolLink.locator("img")).toHaveCount(0);
});
