import { expect, test } from "@playwright/test";
import { authenticateAdmin } from "./fixtures/admin-session.js";

test("the system page shows each dependency and the email backlog", async ({
  context,
  page,
}) => {
  await authenticateAdmin(context);
  await page.goto("/system");
  await expect(
    page.getByRole("heading", { level: 1, name: "System" }),
  ).toBeVisible();

  const dependencies = page.getByRole("region", { name: "Dependencies" });
  await expect(dependencies.locator("dl > div")).toHaveText([
    "School logo storageAnswering",
    "IGDB game dataNot answering",
  ]);

  const outbox = page.getByRole("region", { name: "Email outbox" });
  await expect(outbox.locator(".summary-card")).toHaveText([
    "Waiting to send2",
    "Being retried1",
    "Failed in the last 7 days3",
  ]);
  await expect(outbox.locator("time")).toHaveAttribute(
    "datetime",
    "2026-09-18T15:00:00Z",
  );
});
