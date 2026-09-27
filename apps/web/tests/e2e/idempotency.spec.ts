import { expect, test, type Page } from "@playwright/test";
import { gotoApp, waitForAppReady } from "./fixtures/app-navigation.js";

const apiURL = "http://127.0.0.1:18081";
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test.beforeEach(async ({ request }) => {
  const response = await request.post(`${apiURL}/__test/reset`);
  expect(response.ok()).toBe(true);
});

async function supportTicketKeys(page: Page): Promise<Array<string | null>> {
  const response = await page.request.get(`${apiURL}/__test/upstream-calls`);
  expect(response.ok()).toBe(true);
  const { calls } = (await response.json()) as {
    calls: Array<{
      method: string;
      pathname: string;
      idempotencyKey: string | null;
    }>;
  };
  return calls
    .filter(
      (call) => call.method === "POST" && call.pathname === "/support-tickets",
    )
    .map((call) => call.idempotencyKey);
}

test("support form keeps its server-rendered key through hydration and rotates it after success", async ({
  page,
}) => {
  const response = await gotoApp(page, "/support");
  const renderedKey = (await response?.text())?.match(
    /<input[^>]*name="idempotency_key"[^>]*value="([^"]+)"/,
  )?.[1];
  expect(renderedKey).toMatch(uuidPattern);
  const keyInput = page.locator('input[name="idempotency_key"]');
  await expect(keyInput).toHaveValue(renderedKey ?? "");

  await page.getByLabel("Email").fill("idempotency@example.test");
  await page.getByLabel("Subject").fill("Duplicate protection");
  await page.getByLabel("Message").fill("Checking the support form key.");
  await page.getByRole("button", { name: "Submit support ticket" }).click();
  await expect(page.getByText("Support ticket submitted.")).toBeVisible();
  await expect(keyInput).not.toHaveValue(renderedKey ?? "");
  const rotatedKey = await keyInput.inputValue();
  expect(rotatedKey).toMatch(uuidPattern);

  await page.getByRole("button", { name: "Submit support ticket" }).click();
  await expect
    .poll(() => supportTicketKeys(page))
    .toEqual([renderedKey, rotatedKey]);
});

test("a form mounted by client navigation gets a fresh key", async ({
  page,
}) => {
  await gotoApp(page, "/support");
  const keyInput = page.locator('input[name="idempotency_key"]');
  const firstKey = await keyInput.inputValue();

  await page
    .getByRole("contentinfo")
    .getByRole("link", { name: "About" })
    .click();
  await expect(page).toHaveURL(/\/about$/);
  await waitForAppReady(page);
  await page
    .getByRole("contentinfo")
    .getByRole("link", { name: "Support" })
    .click();
  await expect(page).toHaveURL(/\/support$/);
  await waitForAppReady(page);

  await expect(keyInput).not.toHaveValue(firstKey);
  expect(await keyInput.inputValue()).toMatch(uuidPattern);
});
