import { expect, type Page } from "@playwright/test";

const password = "E2EPassword123!";

export async function gotoApp(page: Page, path: string) {
  const response = await page.goto(path);
  await waitForAppReady(page);
  return response;
}

export async function logIn(page: Page, email: string, next: string) {
  await gotoApp(page, `/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();

  const expected = new URL(next, "http://browser-test.local");
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === expected.pathname &&
      url.search === expected.search &&
      url.hash === expected.hash,
  );
  await waitForAppReady(page);
}

// Log out sits inside the header's account menu, which stays closed until the
// trigger is pressed.
export async function logOut(page: Page) {
  await page.getByRole("button", { name: "account menu" }).click();
  await page.getByRole("button", { name: "Log out" }).click();
}

export async function waitForAppReady(page: Page) {
  await page.waitForFunction(() => {
    const router = Reflect.get(window, "__TSR_ROUTER__") as
      | {
          state?: {
            isLoading?: boolean;
            location?: { href?: string };
            resolvedLocation?: { href?: string };
            status?: string;
          };
        }
      | undefined;
    const state = router?.state;
    const routerHref = state?.resolvedLocation?.href ?? state?.location?.href;

    return (
      document.documentElement.dataset.appHydrated === "true" &&
      state?.status === "idle" &&
      state.isLoading === false &&
      typeof routerHref === "string" &&
      new URL(routerHref, window.location.origin).href === window.location.href
    );
  });
}
