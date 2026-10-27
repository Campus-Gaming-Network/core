import * as z from "zod";
import { ApiError, type ApiClient } from "../../server/api.server.js";
import { apiErrorReporter } from "../../server/api-error-reporter.server.js";
import type { DataExportNotice } from "./presentation.js";

const entries = z.array(z.record(z.string(), z.unknown()));

/**
 * The export the API builds. Every section is the account holder's own data,
 * so each is passed through whole; the top level is checked so a changed
 * shape fails here instead of reaching the download.
 */
export const dataExportDtoSchema = z.object({
  format_version: z.number().int().positive(),
  exported_at: z.iso.datetime({ offset: true }),
  account: z.record(z.string(), z.unknown()),
  social_links: entries,
  followed_schools: entries,
  school_admin_roles: entries,
  site_roles: entries,
  game_lists: entries,
  teams: entries,
  clubs: entries,
  club_claims: entries,
  events_organized: entries,
  rsvps: entries,
  interested_events: entries,
  tournament_entries: entries,
  support_tickets: entries,
  reports: entries,
  notifications: entries,
  policy_acceptances: entries,
  sessions: entries,
  active_days: z.array(z.iso.date()),
});

type Dependencies = {
  api: ApiClient;
  cookieHeader: string;
  publicOrigin: string;
  reportError?: (error: unknown) => void;
};

const dataPage = "/settings/data";

function seeOther(location: string): Response {
  return new Response(null, {
    status: 303,
    headers: { location, "cache-control": "private, no-store" },
  });
}

function backWith(notice: DataExportNotice): Response {
  return seeOther(`${dataPage}?export=${notice}`);
}

/**
 * Answers the "Download your data" form. It is a plain form post, so it works
 * without JavaScript: the browser saves the response as a file. Server
 * functions get the site's origin check from the CSRF middleware; this route
 * is not a server function, so it makes the same check itself.
 */
export async function dataExportResponse(
  request: Request,
  {
    api,
    cookieHeader,
    publicOrigin,
    reportError = defaultErrorReporter,
  }: Dependencies,
): Promise<Response> {
  if (request.headers.get("origin") !== publicOrigin) {
    return new Response("Forbidden", {
      status: 403,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  if (!cookieHeader) {
    return seeOther(`/login?${new URLSearchParams({ next: dataPage })}`);
  }
  let password = "";
  try {
    const value = (await request.formData()).get("current_password");
    password = typeof value === "string" ? value : "";
  } catch {
    return backWith("failed");
  }
  if (!password) return backWith("wrong-password");

  try {
    const { data } = await api({
      path: "/me/export",
      method: "POST",
      body: { current_password: password },
      cookieHeader,
      cache: "no-store",
      responseSchema: dataExportDtoSchema,
    });
    const day = data.exported_at.slice(0, 10);
    return new Response(`${JSON.stringify(data, null, 2)}\n`, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="campus-gaming-network-data-${day}.json"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return seeOther(`/login?${new URLSearchParams({ next: dataPage })}`);
    }
    if (
      error instanceof ApiError &&
      error.code === "invalid_current_password"
    ) {
      return backWith("wrong-password");
    }
    if (error instanceof ApiError && error.status === 429) {
      return backWith("rate-limited");
    }
    reportError(error);
    return backWith("failed");
  }
}

const defaultErrorReporter = apiErrorReporter("Data export");
