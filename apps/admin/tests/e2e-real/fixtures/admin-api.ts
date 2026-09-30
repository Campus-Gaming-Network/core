import type { APIRequestContext, APIResponse } from "@playwright/test";
import { accessAssertion } from "./access.js";

export const apiURL = "http://127.0.0.1:18090";
export const adminOrigin = "http://127.0.0.1:3310";
export const adminProxySecret = "real-e2e-admin-proxy-secret-0000000";
export const publicProxySecret = "real-e2e-proxy-secret-000000000000";

export const proxyHeaders = { "X-CGN-Admin-Proxy-Secret": adminProxySecret };

export function setCookies(response: APIResponse): string[] {
  return response
    .headersArray()
    .filter((header) => header.name.toLowerCase() === "set-cookie")
    .map((header) => header.value);
}

/** An admin session established straight against the API. */
export type ApiSession = {
  cookieHeader: string;
  csrf: string;
  /** The session's raw cookies, for seeding a browser. */
  cookies: { name: string; value: string }[];
  /** Headers for a state-changing request from the console's own origin. */
  mutationHeaders: Record<string, string>;
  /** Headers for a read. */
  readHeaders: Record<string, string>;
};

export async function exchangeSession(
  request: APIRequestContext,
  email: string,
  assertion = accessAssertion(email),
): Promise<ApiSession> {
  const response = await request.post(`${apiURL}/admin/v1/auth/exchange`, {
    headers: {
      ...proxyHeaders,
      Origin: adminOrigin,
      "Cf-Access-Jwt-Assertion": assertion,
    },
  });
  if (response.status() !== 201) {
    throw new Error(`exchange for ${email} returned ${response.status()}`);
  }
  const cookies = setCookies(response).map((cookie) => cookie.split(";")[0]);
  const csrf =
    cookies
      .find((cookie) => cookie.startsWith("cgn_admin_csrf="))
      ?.split("=")[1] ?? "";
  const cookieHeader = cookies.join("; ");
  // The BFF vouches for the Access identity on every request after the first.
  const vouched = { ...proxyHeaders, "X-CGN-Admin-Access-Email": email };
  return {
    cookieHeader,
    csrf,
    cookies: cookies.map((cookie) => {
      const [name, ...value] = cookie.split("=");
      return { name, value: value.join("=") };
    }),
    mutationHeaders: {
      ...vouched,
      Cookie: cookieHeader,
      Origin: adminOrigin,
      "X-CGN-Admin-CSRF": csrf,
    },
    readHeaders: { ...vouched, Cookie: cookieHeader },
  };
}
