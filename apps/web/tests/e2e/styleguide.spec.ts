import { expect, test } from "@playwright/test";
import { gotoApp } from "./fixtures/app-navigation.js";

test("/styleguide shows each stylesheet token with the value the browser applies", async ({
  page,
}) => {
  await gotoApp(page, "/styleguide");

  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    "noindex",
  );

  // The build minifies the stylesheet, so the text of a value can differ from
  // the source. Each value written on the page is applied to a probe element
  // and compared with what the token itself produces on the sample beside it.
  const tokens = await page
    .locator("[data-tokens] > li")
    .evaluateAll((items) => {
      const properties = {
        color: "backgroundColor",
        radius: "borderTopLeftRadius",
        shadow: "boxShadow",
      } as const;
      return items.map((item) => {
        const kind = item.parentElement?.dataset.tokens as
          | keyof typeof properties
          | undefined;
        const sample = item.querySelector("span");
        if (!kind || !sample) return { written: "missing", applied: "" };
        const property = properties[kind];
        const probe = document.createElement("span");
        probe.style[property] = item.querySelector("small")?.textContent ?? "";
        document.body.append(probe);
        const written = getComputedStyle(probe)[property];
        probe.remove();
        return { written, applied: getComputedStyle(sample)[property] };
      });
    });

  expect(tokens.length).toBeGreaterThan(0);
  expect(tokens.filter((token) => token.written !== token.applied)).toEqual([]);
});
