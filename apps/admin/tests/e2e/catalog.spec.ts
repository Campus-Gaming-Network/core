import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  authenticateAdmin,
  catalogSchoolID,
  gatedMemberID,
  memberID,
  operatorID,
} from "./fixtures/admin-session.js";

const apiURL = "http://127.0.0.1:18082";

test.beforeEach(async ({ request }) => {
  const response = await request.post(`${apiURL}/__test/reset`);
  expect(response.ok()).toBe(true);
});

// Fills a named command panel's reason, confirms it when asked, and submits.
async function runCommand(form: Locator, reason: string, submit: string) {
  await form.getByLabel("Reason").fill(reason);
  const confirmation = form.getByLabel(
    "I understand this change takes effect immediately.",
  );
  if (await confirmation.count()) await confirmation.check();
  await form.getByRole("button", { name: submit }).click();
}

function panel(page: Page, name: string): Locator {
  return page.getByRole("region", { name, exact: true });
}

test("a school is created, edited, and deactivated with an audited reason", async ({
  context,
  page,
}) => {
  await authenticateAdmin(context);
  await page.goto("/schools/new");
  await page.getByLabel("Name").fill("Night Owl College");
  await page.getByLabel("Slug").fill("night-owl-college");
  await page.getByLabel("Reason").fill("New member school");
  await page.getByRole("button", { name: "Create school" }).click();
  await expect(page).toHaveURL(/\/schools\/[0-9a-f-]{36}\?notice=created$/);
  await expect(page.getByRole("status")).toHaveText("Created.");

  const edit = panel(page, "Edit school");
  await edit.getByLabel("Name").fill("Night Owl University");
  await edit.getByLabel("Reason").fill("Official name");
  await edit.getByRole("button", { name: "Save school" }).click();
  await expect(page).toHaveURL(/notice=saved$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Night Owl University" }),
  ).toBeVisible();

  await runCommand(
    panel(page, "Deactivate"),
    "Closed for the season",
    "Deactivate school",
  );
  await expect(page.getByRole("status")).toHaveText("School deactivated.");
  await expect(
    page.getByText("School deactivated", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Closed for the season")).toBeVisible();
  await expect(panel(page, "Reactivate")).toBeVisible();
});

test("a destructive command requires confirmation and explains refusals", async ({
  context,
  page,
}) => {
  await authenticateAdmin(context);
  await page.goto(`/schools/${catalogSchoolID}`);
  const remove = panel(page, "Delete");
  await remove.getByLabel("Reason").fill("Duplicate record");
  await remove.getByRole("button", { name: "Delete school" }).click();
  // The required confirmation blocks submission in the browser.
  await expect(page).toHaveURL(new RegExp(`/schools/${catalogSchoolID}$`));

  await remove
    .getByLabel("I understand this change takes effect immediately.")
    .check();
  await remove.getByRole("button", { name: "Delete school" }).click();
  await expect(remove.getByRole("alert")).toHaveText(
    "This record is still referenced by events, teams, follows, or grants. Deactivate it instead.",
  );
});

test("school-admin access is granted, revoked, and restorable", async ({
  context,
  page,
}) => {
  await authenticateAdmin(context);
  await page.goto(`/schools/${catalogSchoolID}`);
  const grant = panel(page, "Grant school-admin access");
  await grant.getByLabel("User ID").fill(memberID);
  await runCommand(grant, "Esports coordinator", "Grant access");
  await expect(page.getByRole("status")).toHaveText(
    "School-admin access granted.",
  );

  await runCommand(panel(page, "Revoke"), "Left the role", "Revoke access");
  await expect(page.getByRole("status")).toHaveText(
    "School-admin access revoked.",
  );
  await expect(panel(page, "Restore")).toBeVisible();
});

test("a game is added, hidden from the picker, and deleted", async ({
  context,
  page,
}) => {
  await authenticateAdmin(context);
  await page.goto("/games");
  const create = panel(page, "Add a game");
  await create.getByLabel("Name").fill("Lane Legends");
  await create.getByLabel("Slug").fill("lane-legends");
  await create.getByLabel("Reason").fill("Requested by schools");
  await create.getByRole("button", { name: "Create game" }).click();
  await expect(page).toHaveURL(/\/games\/[0-9a-f-]{36}\?notice=created$/);

  const edit = panel(page, "Edit game");
  await edit.getByLabel("Shown in the public game picker").uncheck();
  await edit.getByLabel("Reason").fill("Retired title");
  await edit.getByRole("button", { name: "Save game" }).click();
  await expect(page).toHaveURL(/notice=saved$/);
  await expect(page.getByText("Hidden", { exact: true })).toBeVisible();

  await runCommand(panel(page, "Delete"), "Never used", "Delete game");
  await expect(page.getByRole("status")).toHaveText("Deleted.");
  await expect(
    page.locator(".detail-header").getByText("Deleted"),
  ).toBeVisible();
});

test("suspension waits for a recent identity confirmation", async ({
  context,
  page,
}) => {
  await authenticateAdmin(context);
  await page.goto(`/users/${gatedMemberID}`);
  const suspend = panel(page, "Suspend");
  await expect(suspend.getByRole("button")).toHaveCount(0);
  await suspend.getByRole("link", { name: "Confirm your identity" }).click();

  await expect(page).toHaveURL(
    `/step-up?return=${encodeURIComponent(`/users/${gatedMemberID}`)}`,
  );
  await page.getByRole("button", { name: "Confirm identity" }).click();
  // Locally there is no Cloudflare Access assertion, so step-up fails closed.
  await expect(page).toHaveURL(/\/step-up\?return=.+&error=failed$/);
  await expect(page.getByRole("alert")).toContainText(
    "Your identity could not be confirmed.",
  );
});

test("a recently confirmed operator changes trust and suspends an account", async ({
  context,
  page,
}) => {
  await authenticateAdmin(context, "stepped-up-session");
  await page.goto(`/users/${memberID}`);

  const trust = panel(page, "Staff or faculty");
  await trust.getByRole("combobox").selectOption("true");
  await runCommand(trust, "Verified faculty advisor", "Update trust level");
  await expect(page.getByRole("status")).toHaveText("Trust level updated.");

  await runCommand(
    panel(page, "Suspend"),
    "Confirmed abuse",
    "Suspend account",
  );
  await expect(page.getByRole("status")).toHaveText(
    "Account suspended and its sessions ended.",
  );
  await expect(
    page.locator(".detail-header").getByText("Suspended"),
  ).toBeVisible();
  await expect(
    page.getByText("Account suspended", { exact: true }),
  ).toBeVisible();
});

test("revoking your own site-admin access ends the session immediately", async ({
  context,
  page,
}) => {
  await authenticateAdmin(context, "stepped-up-self-revoke");
  await page.goto("/access/site-admins");
  const ownGrant = page
    .getByRole("listitem")
    .filter({ has: page.getByText(operatorID, { exact: true }) });
  await runCommand(
    ownGrant.getByRole("region", { name: "Revoke access" }),
    "Rotating operators",
    "Revoke site-admin access",
  );

  await expect(
    page.getByRole("heading", { name: "Sign in through Cloudflare Access." }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Admin navigation" }),
  ).toHaveCount(0);
});
