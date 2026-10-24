import * as z from "zod";
import type { GoalSender } from "../../server/analytics.server.js";
import {
  ApiContractError,
  ApiError,
  safeApiErrorMessage,
  type ApiClient,
} from "../../server/api.server.js";
import {
  unlockCookieMutation,
  type CookieMutation,
} from "../../server/cookies.server.js";
import { withHostSchoolLogo } from "../school-slice/school-logos.server.js";
import {
  eventDetailDtoSchema,
  eventDtoSchema,
  emptyResponseDtoSchema,
  eventFormPageInputSchema,
  eventFormViewerDtoSchema,
  eventFormSchoolsResponseDtoSchema,
  eventFormClubsResponseDtoSchema,
  eventFormTeamsResponseDtoSchema,
  eventsBrowseResponseDtoSchema,
  gamesBrowseResponseDtoSchema,
  idResponseDtoSchema,
  type CreateEventPayload,
  type EditEventPageResult,
  type EventInterestInput,
  type EventMutationPayload,
  type EventHostClubDTO,
  type EventHostTeamDTO,
  type EventMutationResult,
  type EventRedirectResult,
  type NewEventPageResult,
  type ReportEventInput,
  type ReportEventResult,
  type EventSlugInput,
  type EventsBrowseInput,
  type EventsBrowseResult,
  type GetEventDetailResult,
  type RSVPEventInput,
  type RSVPEventResult,
  type UnlockEventInput,
  type UnlockEventResult,
} from "./contracts.js";

const unlockResponseSchema = z.object({
  event: eventDtoSchema,
  unlock_token: z.string().min(1),
  expires_at: z.iso.datetime({ offset: true }),
});

type ReadDependencies = {
  api: ApiClient;
  cookieHeader: string;
  unlockHeaders?: HeadersInit;
  reportError?: (error: unknown) => void;
};

type MutationDependencies = ReadDependencies & {
  production: boolean;
  applyCookie: (mutation: CookieMutation) => void;
};

type PublicReadDependencies = Pick<ReadDependencies, "api" | "reportError">;

type EventWriteDependencies = {
  api: ApiClient;
  cookieHeader: string;
  unlockHeaders?: HeadersInit;
  reportError?: (error: unknown) => void;
};

type EventFormPageDependencies = EventWriteDependencies & {
  sessionCookieValue?: string;
};

export async function newEventPageOperation(
  { schoolQuery }: z.output<typeof eventFormPageInputSchema>,
  dependencies: EventFormPageDependencies,
): Promise<NewEventPageResult> {
  const normalizedSchoolQuery = schoolQuery.trim();
  const {
    api,
    cookieHeader,
    sessionCookieValue,
    reportError = defaultErrorReporter,
  } = dependencies;
  const viewer = await readEventFormViewer({
    api,
    cookieHeader,
    sessionCookieValue,
    reportError,
  });
  if (viewer.status === "unauthenticated") return viewer;
  if (viewer.status === "error") {
    return { status: "error", message: "Event creation is unavailable." };
  }

  const [resources, hostTeams, hostClubs] = await Promise.all([
    readEventFormResources(normalizedSchoolQuery, api, reportError),
    readEventFormHostTeams(api, cookieHeader, reportError),
    readEventFormHostClubs(api, cookieHeader, reportError),
  ]);
  if (resources.status === "error") {
    return { status: "error", message: "Event creation is unavailable." };
  }

  return {
    status: "ready",
    defaultSchoolID: viewer.profile.home_school_id,
    ...(viewer.profile.home_school
      ? { defaultSchool: viewer.profile.home_school }
      : {}),
    defaultTimeZone: viewer.profile.timezone,
    games: resources.games,
    hostTeams,
    hostClubs,
    schools: resources.schools,
    schoolSearchFailed: resources.schoolSearchFailed,
  };
}

export async function editEventPageOperation(
  input: EventSlugInput & { schoolQuery: string },
  dependencies: EventFormPageDependencies,
): Promise<EditEventPageResult> {
  const normalizedSchoolQuery = input.schoolQuery.trim();
  const {
    api,
    cookieHeader,
    sessionCookieValue,
    unlockHeaders,
    reportError = defaultErrorReporter,
  } = dependencies;
  const viewer = await readEventFormViewer({
    api,
    cookieHeader,
    sessionCookieValue,
    reportError,
  });
  if (viewer.status === "unauthenticated") return viewer;
  if (viewer.status === "error") {
    return { status: "error", message: "Event editing is unavailable." };
  }

  const detail = await getEventDetailOperation(
    { slug: input.slug },
    { api, cookieHeader, unlockHeaders, reportError },
  );
  if (detail.status === "not_found") return detail;
  if (detail.status === "error") {
    return { status: "error", message: "Event editing is unavailable." };
  }
  if ("locked" in detail.event) {
    return { status: "denied", reason: "locked" };
  }
  if (detail.event.cancelled_at) {
    return { status: "denied", reason: "cancelled" };
  }
  if (!detail.event.viewer_can_edit) {
    return { status: "denied", reason: "forbidden" };
  }
  if (detail.event.lifecycle === "ended") {
    return { status: "denied", reason: "ended" };
  }

  const [resources, hostTeams, hostClubs] = await Promise.all([
    readEventFormResources(normalizedSchoolQuery, api, reportError),
    readEventFormHostTeams(api, cookieHeader, reportError),
    readEventFormHostClubs(api, cookieHeader, reportError),
  ]);
  if (resources.status === "error") {
    return { status: "error", message: "Event editing is unavailable." };
  }
  // The event keeps its team or club even when the editor no longer leads it.
  const currentTeam = detail.event.host_team;
  const currentClub = detail.event.host_club;

  return {
    status: "ready",
    event: detail.event,
    viewerID: viewer.profile.id,
    games: resources.games,
    hostTeams:
      currentTeam && !hostTeams.some((team) => team.id === currentTeam.id)
        ? [currentTeam, ...hostTeams]
        : hostTeams,
    hostClubs:
      currentClub && !hostClubs.some((club) => club.id === currentClub.id)
        ? [currentClub, ...hostClubs]
        : hostClubs,
    schools: resources.schools,
    schoolSearchFailed: resources.schoolSearchFailed,
  };
}

export async function getEventsBrowseOperation(
  input: EventsBrowseInput,
  { api, reportError = defaultErrorReporter }: PublicReadDependencies,
): Promise<EventsBrowseResult> {
  try {
    return { ...(await readEvents(api, input)), eventsUnavailable: false };
  } catch (error) {
    reportError(error);
    return {
      events: [],
      limit: 25,
      has_more: false,
      has_previous: false,
      eventsUnavailable: true,
    };
  }
}

// How many public events each home page section previews.
const homeEventsLimit = 6;

const weekMilliseconds = 7 * 24 * 60 * 60 * 1000;

/**
 * The home page's two previews of public events, each in the events page's
 * order: "this week" is what is under way or starts in the next seven days,
 * and "more" is everything that starts after that. The cut is rounded down to
 * the minute. A failure never fails the home page: it reports itself as
 * unavailable so the page can say so.
 */
export async function homeEventsOperation({
  api,
  now = () => new Date(),
  reportError = defaultErrorReporter,
}: PublicReadDependencies & { now?: () => Date }) {
  const weekEnd = new Date(now().getTime() + weekMilliseconds);
  weekEnd.setUTCSeconds(0, 0);
  const cut = weekEnd.toISOString().replace(".000Z", "Z");
  const read = async (range: string) => {
    const { data } = await api({
      path: `/events?limit=${homeEventsLimit}&${range}=${encodeURIComponent(cut)}`,
      cache: "no-store",
      responseSchema: eventsBrowseResponseDtoSchema,
    });
    return data.events.map(withHostSchoolLogo);
  };
  try {
    const [thisWeek, later] = await Promise.all([
      read("starts_before"),
      read("starts_after"),
    ]);
    return { thisWeek, later, unavailable: false };
  } catch (error) {
    reportError(error);
    return { thisWeek: [], later: [], unavailable: true };
  }
}

// How many upcoming events a team or club page lists.
const hostedEventsLimit = 6;

/**
 * The public events a team or club hosts that have not ended, soonest first.
 * A failure never fails the page: it reports itself as unavailable.
 */
export async function hostedEventsOperation(
  { host, slug }: { host: "team" | "club"; slug: string },
  { api, reportError = defaultErrorReporter }: PublicReadDependencies,
) {
  try {
    const { data } = await api({
      path: `/events?limit=${hostedEventsLimit}&${host}=${encodeURIComponent(slug)}`,
      cache: "no-store",
      responseSchema: eventsBrowseResponseDtoSchema,
    });
    return { events: data.events.map(withHostSchoolLogo), unavailable: false };
  } catch (error) {
    reportError(error);
    return { events: [], unavailable: true };
  }
}

export async function getEventDetailOperation(
  { slug }: EventSlugInput,
  {
    api,
    cookieHeader,
    unlockHeaders,
    reportError = defaultErrorReporter,
  }: ReadDependencies,
): Promise<GetEventDetailResult> {
  try {
    const { data } = await api({
      path: `/events/${encodeURIComponent(slug)}`,
      cookieHeader,
      headers: unlockHeaders,
      cache: "no-store",
      responseSchema: eventDetailDtoSchema,
    });
    return {
      status: "found",
      event: "host_school" in data ? withHostSchoolLogo(data) : data,
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return { status: "not_found" };
    }
    reportError(error);
    return { status: "error", message: safeApiErrorMessage(error) };
  }
}

export async function unlockEventOperation(
  { slug, password }: UnlockEventInput,
  {
    api,
    production,
    applyCookie,
    reportError = defaultErrorReporter,
  }: Pick<
    MutationDependencies,
    "api" | "production" | "applyCookie" | "reportError"
  >,
): Promise<UnlockEventResult> {
  try {
    const { data } = await api({
      path: `/events/${encodeURIComponent(slug)}/unlock`,
      method: "POST",
      body: { password },
      responseSchema: unlockResponseSchema,
    });

    applyCookie(
      unlockCookieMutation(
        slug,
        data.unlock_token,
        data.expires_at,
        production,
      ),
    );

    return {
      status: "success",
      event: data.event,
      redirectTo: `/events/${encodeURIComponent(data.event.slug)}?event=unlocked`,
    };
  } catch (error) {
    reportError(error);
    return { status: "error", message: safeApiErrorMessage(error) };
  }
}

export async function rsvpEventOperation(
  { slug, response }: RSVPEventInput,
  {
    api,
    cookieHeader,
    unlockHeaders,
    reportError = defaultErrorReporter,
    sendGoal = () => {},
  }: ReadDependencies & { sendGoal?: GoalSender },
): Promise<RSVPEventResult> {
  try {
    const { data } = await api({
      path: `/events/${encodeURIComponent(slug)}/rsvp`,
      method: "POST",
      cookieHeader,
      headers: unlockHeaders,
      body: { response },
      responseSchema: eventDtoSchema,
    });
    sendGoal({ name: "RSVP", response });

    return {
      status: "success",
      event: data,
      redirectTo: `/events/${encodeURIComponent(data.slug)}?event=rsvp-updated`,
    };
  } catch (error) {
    reportError(error);
    return { status: "error", message: safeApiErrorMessage(error) };
  }
}

export async function reportEventOperation(
  { slug, reason, idempotency_key }: ReportEventInput,
  {
    api,
    cookieHeader,
    reportError = defaultErrorReporter,
  }: EventWriteDependencies,
): Promise<ReportEventResult> {
  try {
    await api({
      path: `/events/${encodeURIComponent(slug)}/report`,
      method: "POST",
      cookieHeader,
      headers: { "idempotency-key": idempotency_key },
      body: { reason },
      responseSchema: idResponseDtoSchema,
    });
    return { status: "success", message: "Report submitted for review." };
  } catch (error) {
    reportError(error);
    return { status: "error", message: safeApiErrorMessage(error) };
  }
}

export async function createEventOperation(
  { idempotency_key, ...input }: CreateEventPayload,
  {
    api,
    cookieHeader,
    reportError = defaultErrorReporter,
  }: EventWriteDependencies,
): Promise<EventMutationResult> {
  try {
    const { data } = await api({
      path: "/events",
      method: "POST",
      cookieHeader,
      headers: { "idempotency-key": idempotency_key },
      body: input,
      responseSchema: eventDtoSchema,
    });
    return {
      status: "success",
      event: data,
      redirectTo: `/events/${encodeURIComponent(data.slug)}?event=created`,
    };
  } catch (error) {
    reportError(error);
    return { status: "error", message: safeApiErrorMessage(error) };
  }
}

export async function updateEventOperation(
  { slug, ...input }: EventMutationPayload & { slug: string },
  {
    api,
    cookieHeader,
    reportError = defaultErrorReporter,
  }: EventWriteDependencies,
): Promise<EventMutationResult> {
  try {
    const { data } = await api({
      path: `/events/${encodeURIComponent(slug)}`,
      method: "PATCH",
      cookieHeader,
      body: input,
      responseSchema: eventDtoSchema,
    });
    return {
      status: "success",
      event: data,
      redirectTo: `/events/${encodeURIComponent(data.slug)}?event=updated`,
    };
  } catch (error) {
    reportError(error);
    return { status: "error", message: safeApiErrorMessage(error) };
  }
}

export async function cancelEventOperation(
  { slug }: EventSlugInput,
  {
    api,
    cookieHeader,
    reportError = defaultErrorReporter,
  }: EventWriteDependencies,
): Promise<EventRedirectResult> {
  try {
    await api({
      path: `/events/${encodeURIComponent(slug)}`,
      method: "DELETE",
      cookieHeader,
      responseSchema: emptyResponseDtoSchema,
    });
    return { redirectTo: "/events?event=cancelled" };
  } catch (error) {
    reportError(error);
    return {
      redirectTo: `/events/${encodeURIComponent(slug)}?event=cancel-failed`,
    };
  }
}

export async function eventInterestOperation(
  { slug, interested }: EventInterestInput,
  {
    api,
    cookieHeader,
    unlockHeaders,
    reportError = defaultErrorReporter,
  }: EventWriteDependencies,
): Promise<EventRedirectResult> {
  try {
    const { data } = await api({
      path: `/events/${encodeURIComponent(slug)}/interest`,
      method: interested ? "POST" : "DELETE",
      cookieHeader,
      headers: unlockHeaders,
      responseSchema: eventDtoSchema,
    });
    return {
      redirectTo: `/events/${encodeURIComponent(data.slug)}?event=${
        interested ? "interest-added" : "interest-removed"
      }`,
    };
  } catch (error) {
    reportError(error);
    return {
      redirectTo: `/events/${encodeURIComponent(slug)}?event=interest-failed`,
    };
  }
}

async function readEventFormViewer({
  api,
  cookieHeader,
  sessionCookieValue,
  reportError,
}: EventFormPageDependencies): Promise<
  | {
      status: "ready";
      profile: z.output<typeof eventFormViewerDtoSchema>;
    }
  | { status: "unauthenticated" }
  | { status: "error" }
> {
  if (!sessionCookieValue) return { status: "unauthenticated" };

  try {
    const { data } = await api({
      path: "/me",
      cookieHeader,
      cache: "no-store",
      responseSchema: eventFormViewerDtoSchema,
    });
    return { status: "ready", profile: data };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return { status: "unauthenticated" };
    }
    reportError?.(error);
    return { status: "error" };
  }
}

/**
 * The teams the viewer owns or captains, which may host their events. A
 * failed read leaves the choice out rather than blocking the form.
 */
async function readEventFormHostTeams(
  api: ApiClient,
  cookieHeader: string,
  reportError: (error: unknown) => void,
): Promise<EventHostTeamDTO[]> {
  try {
    const { data } = await api({
      path: "/me/teams?limit=25",
      cookieHeader,
      cache: "no-store",
      responseSchema: eventFormTeamsResponseDtoSchema,
    });
    return data.teams
      .filter(
        (team) =>
          team.viewer_role === "owner" || team.viewer_role === "captain",
      )
      .map(({ id, name, slug }) => ({ id, name, slug }));
  } catch (error) {
    reportError(error);
    return [];
  }
}

/**
 * The clubs the viewer owns or edits, which may host their events. A failed
 * read leaves the choice out rather than blocking the form.
 */
async function readEventFormHostClubs(
  api: ApiClient,
  cookieHeader: string,
  reportError: (error: unknown) => void,
): Promise<EventHostClubDTO[]> {
  try {
    const { data } = await api({
      path: "/me/clubs",
      cookieHeader,
      cache: "no-store",
      responseSchema: eventFormClubsResponseDtoSchema,
    });
    return data.clubs
      .filter(
        (club) => club.viewer_role === "owner" || club.viewer_role === "editor",
      )
      .map(({ id, name, slug, school }) => ({ id, name, slug, school }));
  } catch (error) {
    reportError(error);
    return [];
  }
}

async function readEventFormResources(
  schoolQuery: string,
  api: ApiClient,
  reportError: (error: unknown) => void,
): Promise<
  | {
      status: "ready";
      games: z.output<typeof gamesBrowseResponseDtoSchema>["games"];
      schools: z.output<typeof eventFormSchoolsResponseDtoSchema>["schools"];
      schoolSearchFailed: boolean;
    }
  | { status: "error" }
> {
  const schoolsPromise =
    schoolQuery.length >= 2
      ? readEventFormSchools(api, schoolQuery)
          .then((schools) => ({ schools, failed: false }))
          .catch((error: unknown) => {
            reportError(error);
            return { schools: [], failed: true };
          })
      : Promise.resolve({ schools: [], failed: false });

  try {
    const [{ data: games }, schools] = await Promise.all([
      api({
        path: "/games",
        cache: "no-store",
        responseSchema: gamesBrowseResponseDtoSchema,
      }),
      schoolsPromise,
    ]);
    return {
      status: "ready",
      games: games.games,
      schools: schools.schools,
      schoolSearchFailed: schools.failed,
    };
  } catch (error) {
    reportError(error);
    return { status: "error" };
  }
}

async function readEventFormSchools(api: ApiClient, query: string) {
  const search = new URLSearchParams({ q: query, limit: "50" });
  const { data } = await api({
    path: `/schools?${search.toString()}`,
    cache: "no-store",
    responseSchema: eventFormSchoolsResponseDtoSchema,
  });
  return data.schools;
}

async function readEvents(api: ApiClient, input: EventsBrowseInput) {
  const search = new URLSearchParams();
  if (input.game) search.set("game", input.game);
  if (input.school) search.set("school", input.school);
  if (input.format) search.set("format", input.format);
  if (input.audience) search.set("audience", input.audience);
  if (input.type) search.set("type", input.type);
  if (input.cost) search.set("cost", input.cost);
  if (input.q) search.set("q", input.q);
  if (input.from) search.set("from", input.from);
  if (input.to) search.set("to", input.to);
  search.set("limit", "25");
  if (input.after) search.set("after", input.after);
  if (input.before) search.set("before", input.before);

  const { data } = await api({
    path: `/events?${search.toString()}`,
    cache: "no-store",
    responseSchema: eventsBrowseResponseDtoSchema,
  });
  return { ...data, events: data.events.map(withHostSchoolLogo) };
}

function defaultErrorReporter(error: unknown): void {
  if (error instanceof ApiContractError) {
    console.error("API response contract violation", {
      path: error.path,
      issues: error.issues,
    });
  } else if (!(error instanceof ApiError)) {
    console.error("Event request failed");
  }
}
