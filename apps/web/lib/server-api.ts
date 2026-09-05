import { cookies, headers } from "next/headers";
import { cache } from "react";
import { ApiError, apiRequest } from "./cgn-api";
import {
  dashboardEventsResponseSchema,
  eventDetailSchema,
  eventsResponseSchema,
  followedSchoolsResponseSchema,
  gamesResponseSchema,
  myTeamsResponseSchema,
  profileSchema,
  publicProfileSchema,
  schoolSchema,
  schoolsResponseSchema,
  teamSchema,
  teamsResponseSchema
} from "./api-contracts";
import {
  buildDashboardEventsRequest,
  buildMyTeamsRequest
} from "./pass-v0-requests";

// The school and game catalogs change on the order of once or twice a year and
// carry no viewer-specific fields, so Next.js can hold them across requests.
// Everything else keeps the no-store default, because it either reads the
// session or changes with user activity.
const catalogRevalidateSeconds = 300;

export async function incomingCookieHeader() {
  const requestHeaders = await headers();

  return requestHeaders.get("cookie") ?? "";
}

// Requests default to cache: "no-store", which Next.js does not deduplicate.
// The per-request getters below are wrapped in React cache() so a route's
// generateMetadata and its page body share a single API call instead of
// doubling every request. cache() compares arguments by reference, so the
// wrapped functions take primitives rather than options objects.
export const currentProfile = cache(async () => {
  try {
    const { data } = await apiRequest({
      path: "/me",
      cookieHeader: await incomingCookieHeader(),
      responseSchema: profileSchema
    });

    return data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return null;
    }

    throw error;
  }
});

export async function listSchools(params: {
  query?: string;
  state?: string;
  limit?: number;
  offset?: number;
}) {
  const query = new URLSearchParams();

  if (params.query) {
    query.set("q", params.query);
  }
  if (params.state) {
    query.set("state", params.state);
  }
  if (params.limit) {
    query.set("limit", String(params.limit));
  }
  if (params.offset) {
    query.set("offset", String(params.offset));
  }

  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  const { data } = await apiRequest({
    path: `/schools${suffix}`,
    revalidate: catalogRevalidateSeconds,
    responseSchema: schoolsResponseSchema
  });

  return data;
}

export const getSchool = cache(async (slug: string) => {
  const { data } = await apiRequest({
    path: `/schools/${encodeURIComponent(slug)}`,
    revalidate: catalogRevalidateSeconds,
    responseSchema: schoolSchema
  });

  return data;
});

export async function listGames() {
  const { data } = await apiRequest({
    path: "/games",
    revalidate: catalogRevalidateSeconds,
    responseSchema: gamesResponseSchema
  });

  return data.games;
}

export async function listEvents(params: {
  game?: string;
  school?: string;
  format?: string;
  limit?: number;
  offset?: number;
}) {
  const query = new URLSearchParams();

  if (params.game) {
    query.set("game", params.game);
  }
  if (params.school) {
    query.set("school", params.school);
  }
  if (params.format) {
    query.set("format", params.format);
  }
  if (params.limit) {
    query.set("limit", String(params.limit));
  }
  if (params.offset) {
    query.set("offset", String(params.offset));
  }

  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  const { data } = await apiRequest({
    path: `/events${suffix}`,
    responseSchema: eventsResponseSchema
  });

  return data;
}

type GetEventOptions = {
  includeCookie?: boolean;
  includeUnlock?: boolean;
};

const fetchEvent = cache(
  async (slug: string, includeCookie: boolean, includeUnlock: boolean) => {
    const unlockHeaders = includeUnlock
      ? await eventUnlockHeaders(slug)
      : undefined;
    const { data } = await apiRequest({
      path: `/events/${encodeURIComponent(slug)}`,
      cookieHeader: includeCookie ? await incomingCookieHeader() : undefined,
      headers: unlockHeaders,
      responseSchema: eventDetailSchema
    });

    return data;
  }
);

export async function getEvent(slug: string, options: GetEventOptions = {}) {
  return fetchEvent(
    slug,
    options.includeCookie === true,
    options.includeUnlock === true
  );
}

export async function getDashboardEvents(limit = 5) {
  const { data } = await apiRequest({
    ...buildDashboardEventsRequest(limit, await incomingCookieHeader()),
    responseSchema: dashboardEventsResponseSchema
  });

  return data;
}

export async function listTeams(params: {
  game?: string;
  school?: string;
  limit?: number;
  offset?: number;
}) {
  const query = new URLSearchParams();

  if (params.game) {
    query.set("game", params.game);
  }
  if (params.school) {
    query.set("school", params.school);
  }
  if (params.limit) {
    query.set("limit", String(params.limit));
  }
  if (params.offset) {
    query.set("offset", String(params.offset));
  }

  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  const { data } = await apiRequest({
    path: `/teams${suffix}`,
    responseSchema: teamsResponseSchema
  });

  return data;
}

export async function listMyTeams(limit = 10) {
  const { data } = await apiRequest({
    ...buildMyTeamsRequest(limit, await incomingCookieHeader()),
    responseSchema: myTeamsResponseSchema
  });

  return data.teams;
}

type GetTeamOptions = {
  includeCookie?: boolean;
};

const fetchTeam = cache(async (slug: string, includeCookie: boolean) => {
  const { data } = await apiRequest({
    path: `/teams/${encodeURIComponent(slug)}`,
    cookieHeader: includeCookie ? await incomingCookieHeader() : undefined,
    responseSchema: teamSchema
  });

  return data;
});

export async function getTeam(slug: string, options: GetTeamOptions = {}) {
  return fetchTeam(slug, options.includeCookie === true);
}

export function eventUnlockCookieName(slug: string) {
  return `cgn_event_unlock_${slug.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

async function eventUnlockToken(slug: string) {
  const cookieStore = await cookies();
  return cookieStore.get(eventUnlockCookieName(slug))?.value ?? "";
}

export async function eventUnlockHeaders(slug: string) {
  const token = await eventUnlockToken(slug);
  return token ? { "X-CGN-Event-Unlock": token } : undefined;
}

export async function listFollowedSchools() {
  const { data } = await apiRequest({
    path: "/me/schools",
    cookieHeader: await incomingCookieHeader(),
    responseSchema: followedSchoolsResponseSchema
  });

  return data.schools;
}

export const getPublicProfile = cache(async (id: string) => {
  const { data } = await apiRequest({
    path: `/users/${encodeURIComponent(id)}`,
    responseSchema: publicProfileSchema
  });

  return data;
});
