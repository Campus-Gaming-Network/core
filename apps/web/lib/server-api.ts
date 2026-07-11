import { headers } from "next/headers";
import {
  type EventDetail,
  type EventsResponse,
  type FollowedSchoolsResponse,
  type GamesResponse,
  type Profile,
  type PublicProfile,
  type School,
  type SchoolsResponse,
  ApiError,
  apiRequest
} from "./cgn-api";

export async function incomingCookieHeader() {
  const requestHeaders = await headers();

  return requestHeaders.get("cookie") ?? "";
}

export async function currentProfile() {
  try {
    const { data } = await apiRequest<Profile>({
      path: "/me",
      cookieHeader: await incomingCookieHeader()
    });

    return data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return null;
    }

    return null;
  }
}

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
  const { data } = await apiRequest<SchoolsResponse>({
    path: `/schools${suffix}`
  });

  return data;
}

export async function getSchool(slug: string) {
  const { data } = await apiRequest<School>({
    path: `/schools/${encodeURIComponent(slug)}`
  });

  return data;
}

export async function listGames() {
  const { data } = await apiRequest<GamesResponse>({
    path: "/games"
  });

  return data.games;
}

export async function listEvents(params: {
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
  const { data } = await apiRequest<EventsResponse>({
    path: `/events${suffix}`
  });

  return data;
}

export async function getEvent(slug: string, includeCookie = false) {
  const { data } = await apiRequest<EventDetail>({
    path: `/events/${encodeURIComponent(slug)}`,
    cookieHeader: includeCookie ? await incomingCookieHeader() : undefined
  });

  return data;
}

export async function listFollowedSchools() {
  const { data } = await apiRequest<FollowedSchoolsResponse>({
    path: "/me/schools",
    cookieHeader: await incomingCookieHeader()
  });

  return data.schools;
}

export async function getPublicProfile(id: string) {
  const { data } = await apiRequest<PublicProfile>({
    path: `/users/${encodeURIComponent(id)}`
  });

  return data;
}

export async function verifyEmailToken(token: string) {
  await apiRequest<{ status: string }>({
    path: `/auth/verify-email?token=${encodeURIComponent(token)}`
  });
}
