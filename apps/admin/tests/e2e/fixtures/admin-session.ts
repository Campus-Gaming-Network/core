import type { BrowserContext } from "@playwright/test";

export const reportID = "11111111-1111-4111-8111-111111111111";
export const ticketID = "22222222-2222-4222-8222-222222222222";

export async function authenticateAdmin(context: BrowserContext) {
  await context.addCookies([
    {
      name: "cgn_admin_session",
      value: "browser-session",
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Strict",
    },
    {
      name: "cgn_admin_csrf",
      value: "csrf-token",
      domain: "127.0.0.1",
      path: "/",
      sameSite: "Strict",
    },
  ]);
}
