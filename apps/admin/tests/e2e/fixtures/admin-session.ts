import type { BrowserContext } from "@playwright/test";

export const reportID = "11111111-1111-4111-8111-111111111111";
export const ticketID = "22222222-2222-4222-8222-222222222222";

export const catalogSchoolID = "88888888-8888-4888-8888-888888888888";
export const memberID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const gatedMemberID = "ffffffff-ffff-4fff-8fff-ffffffffffff";
export const operatorID = "33333333-3333-4333-8333-333333333333";

/**
 * Signs the browser in with the fake API's admin cookies. Session values that
 * start with "stepped-up" carry a recent identity confirmation.
 */
export async function authenticateAdmin(
  context: BrowserContext,
  session = "browser-session",
) {
  await context.addCookies([
    {
      name: "cgn_admin_session",
      value: session,
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
