import { expect, test } from "@playwright/test";
import { gotoApp, logIn } from "./fixtures/app-navigation.js";

const apiURL = "http://127.0.0.1:18081";

test.beforeEach(async ({ page, request }) => {
  const response = await request.post(`${apiURL}/__test/reset`);
  expect(response.ok()).toBe(true);
  // Hover transitions finish at once, so the styles below are final when read.
  await page.emulateMedia({ reducedMotion: "reduce" });
});

// On a touch screen :hover latches after a tap and reads as a stuck selected
// state, so hover styling is limited to pointers that can hover.
test("hover styles apply only where the pointer can hover", async ({
  page,
}, testInfo) => {
  // Between them these pages load every stylesheet that styles :hover.
  await logIn(page, "player@example.test", "/account");
  const ungated: string[] = [];
  for (const path of ["/account", "/events/public-browser-event", "/login"]) {
    await gotoApp(page, path);
    ungated.push(
      ...(await page.evaluate(() => {
        const selectors: string[] = [];
        const visit = (rules: CSSRuleList, gated: boolean) => {
          for (const rule of rules) {
            if (
              !gated &&
              rule instanceof CSSStyleRule &&
              rule.selectorText.includes(":hover") &&
              rule.style.length > 0
            ) {
              selectors.push(rule.selectorText);
            }
            if (
              rule instanceof CSSGroupingRule ||
              rule instanceof CSSStyleRule
            ) {
              visit(
                rule.cssRules,
                gated ||
                  (rule instanceof CSSMediaRule &&
                    /hover:\s*hover/.test(rule.conditionText)),
              );
            }
          }
        };
        for (const sheet of document.styleSheets) visit(sheet.cssRules, false);
        return selectors;
      })),
    );
  }
  expect(ungated).toEqual([]);

  const submit = page.getByRole("button", { name: "Log in" });
  await expect(submit).toHaveCSS("filter", "none");
  await submit.hover();
  await expect(submit).toHaveCSS(
    "filter",
    testInfo.project.name === "mobile-chromium" ? "none" : "brightness(0.93)",
  );
});
