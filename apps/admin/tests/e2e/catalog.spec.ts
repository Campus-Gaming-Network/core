import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  authenticateAdmin,
  catalogSchoolID,
  disguisedSVGLogo,
  gatedMemberID,
  memberID,
  pngLogo,
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
  await grant.getByLabel("User email").fill("member@example.test");
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

test("a game is imported from IGDB, reviewed, and refreshed", async ({
  context,
  page,
}) => {
  await authenticateAdmin(context);
  await page.goto("/games");
  await page.getByRole("link", { name: "Import from IGDB" }).click();
  await page.getByLabel("Game name").fill("rocket");
  await page.getByRole("button", { name: "Search IGDB" }).click();

  const matches = panel(page, "Choose a game");
  await expect(matches.getByRole("radio")).toHaveCount(2);
  await matches.getByLabel("Rocket League (2015)").check();
  await matches.getByLabel("Reason").fill("Requested by schools");
  await matches.getByRole("button", { name: "Import game" }).click();

  // The import lands on the new record, hidden until an admin shows it.
  await expect(page).toHaveURL(/\/games\/[0-9a-f-]{36}\?notice=imported$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Rocket League",
  );
  await expect(page.getByText("Hidden", { exact: true })).toBeVisible();
  await expect(
    panel(page, "Game information").getByText("IGDB", { exact: true }),
  ).toBeVisible();
  // The cover renders from the page itself, never from another origin.
  await expect(
    page.getByRole("img", { name: "Cover of Rocket League" }),
  ).toHaveAttribute("src", /^data:image\/png;base64,/);
  await expect(page.getByText("Game imported from IGDB")).toBeVisible();

  await runCommand(panel(page, "Refresh"), "Monthly sync", "Refresh from IGDB");
  await expect(page.getByRole("status")).toHaveText("Refreshed from IGDB.");
  await expect(page.getByText("Game refreshed from IGDB")).toBeVisible();

  // The same search now links to the record instead of offering an import.
  await page.goto("/games/import?q=rocket");
  await expect(panel(page, "Choose a game").getByRole("radio")).toHaveCount(1);
  await expect(
    panel(page, "Choose a game").getByRole("link", {
      name: "Rocket League (2015)",
    }),
  ).toBeVisible();
});

test("an IGDB outage is explained on the import page", async ({
  context,
  page,
}) => {
  await authenticateAdmin(context);
  await page.goto("/games/import?q=outage");
  await expect(page.getByRole("alert")).toHaveText(
    "IGDB could not be reached. Try again later.",
  );
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
    .filter({ has: page.getByRole("link", { name: "Operator", exact: true }) });
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

test("a logo is uploaded after rejected files, previewed, and removed", async ({
  context,
  page,
}) => {
  await authenticateAdmin(context);
  await page.goto(`/schools/${catalogSchoolID}`);
  const logo = panel(page, "Logo");
  await expect(
    logo.getByText("No logo yet. The school shows the placeholder."),
  ).toBeVisible();
  const file = logo.getByLabel("Logo file");

  // An oversized file is refused in the browser before it is sent.
  await file.setInputFiles({
    name: "huge.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
  });
  await expect(file).toHaveAttribute("aria-invalid", "true");
  await expect(logo.locator("#logo-file-error")).toHaveText(
    "The file is larger than 5 MB. Export a smaller PNG or JPEG and try again.",
  );

  // The server judges the bytes, not the name or declared type.
  await file.setInputFiles(disguisedSVGLogo);
  await logo.getByLabel("Reason").fill("Official logo from the school");
  await logo.getByRole("button", { name: "Upload logo" }).click();
  await expect(logo.getByRole("alert")).toHaveText(
    "Upload a PNG or JPEG image. SVG, GIF, WebP, and animated images are not accepted.",
  );

  await file.setInputFiles(pngLogo);
  await logo.getByRole("button", { name: "Upload logo" }).click();
  await expect(page).toHaveURL(/notice=logo-updated$/);
  await expect(page.getByRole("status")).toHaveText("Logo updated.");
  const preview = logo.getByRole("img", {
    name: "Browser Test University logo",
  });
  await expect(preview).toBeVisible();
  // The image loads under the Admin Console's content security policy.
  await expect
    .poll(() =>
      preview.evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBe(1);

  await runCommand(
    panel(page, "Remove logo"),
    "Rebrand pending",
    "Remove logo",
  );
  await expect(page.getByRole("status")).toHaveText(
    "Logo removed. The school shows the placeholder again.",
  );
  await expect(logo.getByRole("img")).toHaveCount(0);
  await expect(page.getByText("Logo updated", { exact: true })).toBeVisible();
  await expect(page.getByText("Logo removed", { exact: true })).toBeVisible();
});
