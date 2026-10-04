import assert from "node:assert/strict";
import test from "node:test";
import { nextColorTheme, themeFromCookie } from "../src/features/theme.js";

test("the persisted Admin Console theme accepts only exact theme values", () => {
  assert.equal(themeFromCookie("cgn_admin_theme=light"), "light");
  assert.equal(
    themeFromCookie("session=opaque; cgn_admin_theme=dark; other=value"),
    "dark",
  );
  assert.equal(themeFromCookie("cgn_admin_theme=LIGHT"), undefined);
  assert.equal(themeFromCookie("cgn_admin_theme=system"), undefined);
  assert.equal(themeFromCookie("unrelated=light"), undefined);
});

test("the Admin Console theme toggles between light and dark", () => {
  assert.equal(nextColorTheme("dark"), "light");
  assert.equal(nextColorTheme("light"), "dark");
});
