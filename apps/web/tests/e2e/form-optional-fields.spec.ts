import { expect, test } from "@playwright/test";
import { gotoApp, logIn } from "./fixtures/app-navigation.js";

const note = "Fields are required unless marked optional.";

test("forms say which fields are optional in the field's label", async ({
  page,
}) => {
  await logIn(page, "optional-fields@example.test", "/events/new");
  await expect(page.getByText(note)).toBeVisible();
  // The marker is part of the label, so it is in the control's name too.
  await expect(page.locator(".event-form .field-optional")).toHaveCount(7);
  for (const [label, required] of [
    ["Title", true],
    ["Description (optional)", false],
    ["Location name (optional)", false],
    ["Online URL (optional)", false],
    ["Address (optional)", false],
    ["Capacity (optional)", false],
    ["Payment note (optional)", false],
    ["Payment URL (optional)", false],
  ] as const) {
    await expect(
      page.getByLabel(label, { exact: true }),
      label,
    ).toHaveJSProperty("required", required);
  }

  await gotoApp(page, "/teams/new");
  await expect(page.getByText(note)).toBeVisible();
  await expect(
    page.getByLabel("Description (optional)", { exact: true }),
  ).toBeVisible();
  // A select's options are part of its label's text, so this is not exact.
  await expect(page.getByLabel("School link (optional)")).toBeVisible();

  await gotoApp(page, "/account");
  await expect(page.getByText(note)).toBeVisible();
  // The saved bio is part of the label's text, so this is not exact either.
  await expect(page.getByLabel("Bio (optional)")).toBeVisible();

  await gotoApp(page, "/support");
  await expect(page.getByText(note)).toBeVisible();
  await expect(
    page.getByLabel("Name (optional)", { exact: true }),
  ).toBeVisible();
});
