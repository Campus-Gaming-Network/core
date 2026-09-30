import {
  expect,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { signInThroughAccess } from "./access.js";

export function panel(page: Page, name: string): Locator {
  return page.getByRole("region", { name, exact: true });
}

export async function runCommand(
  form: Locator,
  reason: string,
  submit: string,
) {
  await form.getByLabel("Reason").fill(reason);
  const confirmation = form.getByLabel(
    "I understand this change takes effect immediately.",
  );
  if (await confirmation.count()) await confirmation.check();
  await form.getByRole("button", { name: submit }).click();
}

// Establishes a session, then confirms identity with an assertion issued after
// it. The API requires the confirmation to be newer than the session, and the
// validators allow a few seconds of clock skew, so an assertion issued slightly
// ahead of now is deterministically newer without waiting for the clock.
export async function signInSteppedUp(
  context: BrowserContext,
  page: Page,
  email: string,
) {
  await signInThroughAccess(context, email);
  await page.goto("/");
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  await signInThroughAccess(context, email, { issuedSecondsAgo: -5 });
  await page.goto("/step-up?return=%2F");
  await page.getByRole("button", { name: "Confirm identity" }).click();
  await expect(page).toHaveURL(/notice=stepped-up/);
}
