import * as z from "zod";
import {
  ApiContractError,
  ApiError,
  safeApiErrorMessage,
  type ApiClient
} from "../../server/api.server.js";
import {
  unlockCookieMutation,
  type CookieMutation
} from "../../server/cookies.server.js";
import {
  eventDetailDtoSchema,
  eventDtoSchema,
  emptyResponseDtoSchema,
  eventFormPageInputSchema,
  eventFormViewerDtoSchema,
  eventFormSchoolsResponseDtoSchema,
  eventsBrowseResponseDtoSchema,
  gamesBrowseResponseDtoSchema,
  idResponseDtoSchema,
  type EditEventPageResult,
  type EventInterestInput,
  type EventMutationPayload,
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
  type UnlockEventResult
} from "./contracts.js";

const unlockResponseSchema = z.object({
  event: eventDtoSchema,
  unlock_token: z.string().min(1),
  expires_at: z.iso.datetime({ offset: true })
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
  dependencies: EventFormPageDependencies
): Promise<NewEventPageResult> {
  const normalizedSchoolQuery = schoolQuery.trim();
  const {
    api,
    cookieHeader,
    sessionCookieValue,
    reportError = defaultErrorReporter
  } = dependencies;
  const viewer = await readEventFormViewer({
    api,
    cookieHeader,
    sessionCookieValue,
    reportError
  });
  if (viewer.status === "unauthenticated") return viewer;
  if (viewer.status === "error") {
    return { status: "error", message: "Event creation is unavailable." };
  }

  const resources = await readEventFormResources(
    normalizedSchoolQuery,
    api,
    reportError
  );
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
    schools: resources.schools,
    schoolSearchFailed: resources.schoolSearchFailed
  };
}

export async function editEventPageOperation(
  input: EventSlugInput & { schoolQuery: string },
  dependencies: EventFormPageDependencies
): Promise<EditEventPageResult> {
  const normalizedSchoolQuery = input.schoolQuery.trim();
  const {
    api,
    cookieHeader,
    sessionCookieValue,
    unlockHeaders,
    reportError = defaultErrorReporter
  } = dependencies;
  const viewer = await readEventFormViewer({
    api,
    cookieHeader,
    sessionCookieValue,
    reportError
  });
  if (viewer.status === "unauthenticated") return viewer;
  if (viewer.status === "error") {
    return { status: "error", message: "Event editing is unavailable." };
  }

  const detail = await getEventDetailOperation(
    { slug: input.slug },
    { api, cookieHeader, unlockHeaders, reportError }
  );
  if (detail.status === "not_found") return detail;
  if (detail.status === "error") {
    return { status: "error", message: "Event editing is unavailable." };
  }
  if ("locked" in detail.event) {
    return { status: "denied", reason: "locked" };
  }
  if (!detail.event.viewer_can_edit) {
    return { status: "denied", reason: "forbidden" };
  }

  const resources = await readEventFormResources(
    normalizedSchoolQuery,
    api,
    reportError
  );
  if (resources.status === "error") {
    return { status: "error", message: "Event editing is unavailable." };
  }

  return {
    status: "ready",
    event: detail.event,
    games: resources.games,
    schools: resources.schools,
    schoolSearchFailed: resources.schoolSearchFailed
  };
}

export async function getEventsBrowseOperation(
  input: EventsBrowseInput,
  { api, reportError = defaultErrorReporter }: PublicReadDependencies
): Promise<EventsBrowseResult> {
  const [events, games] = await Promise.all([
    readEvents(api, input)
      .then((data) => ({ data, unavailable: false }))
      .catch((error: unknown) => {
        reportError(error);
        return {
          data: {
            events: [],
            limit: 25,
            has_more: false,
            has_previous: false
          },
          unavailable: true
        };
      }),
    api({
      path: "/games",
      cache: "no-store",
      responseSchema: gamesBrowseResponseDtoSchema
    })
      .then(({ data }) => ({ data: data.games, unavailable: false }))
      .catch((error: unknown) => {
        reportError(error);
        return { data: [], unavailable: true };
      })
  ]);

  return {
    ...events.data,
    games: games.data,
    eventsUnavailable: events.unavailable,
    gamesUnavailable: games.unavailable
  };
}

export async function getEventDetailOperation(
  { slug }: EventSlugInput,
  {
    api,
    cookieHeader,
    unlockHeaders,
    reportError = defaultErrorReporter
  }: ReadDependencies
): Promise<GetEventDetailResult> {
  try {
    const { data } = await api({
      path: `/events/${encodeURIComponent(slug)}`,
      cookieHeader,
      headers: unlockHeaders,
      cache: "no-store",
      responseSchema: eventDetailDtoSchema
    });
    return { status: "found", event: data };
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
    reportError = defaultErrorReporter
  }: Pick<MutationDependencies, "api" | "production" | "applyCookie" | "reportError">
): Promise<UnlockEventResult> {
  try {
    const { data } = await api({
      path: `/events/${encodeURIComponent(slug)}/unlock`,
      method: "POST",
      body: { password },
      responseSchema: unlockResponseSchema
    });

    applyCookie(
      unlockCookieMutation(slug, data.unlock_token, data.expires_at, production)
    );

    return {
      status: "success",
      event: data.event,
      redirectTo: `/events/${encodeURIComponent(data.event.slug)}?event=unlocked`
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
    reportError = defaultErrorReporter
  }: ReadDependencies
): Promise<RSVPEventResult> {
  try {
    const { data } = await api({
      path: `/events/${encodeURIComponent(slug)}/rsvp`,
      method: "POST",
      cookieHeader,
      headers: unlockHeaders,
      body: { response },
      responseSchema: eventDtoSchema
    });

    return {
      status: "success",
      event: data,
      redirectTo: `/events/${encodeURIComponent(data.slug)}?event=rsvp-updated`
    };
  } catch (error) {
    reportError(error);
    return { status: "error", message: safeApiErrorMessage(error) };
  }
}

export async function reportEventOperation(
  { slug, reason }: ReportEventInput,
  {
    api,
    cookieHeader,
    reportError = defaultErrorReporter
  }: EventWriteDependencies
): Promise<ReportEventResult> {
  try {
    await api({
      path: `/events/${encodeURIComponent(slug)}/report`,
      method: "POST",
      cookieHeader,
      body: { reason },
      responseSchema: idResponseDtoSchema
    });
    return { status: "success", message: "Report submitted for review." };
  } catch (error) {
    reportError(error);
    return { status: "error", message: safeApiErrorMessage(error) };
  }
}

export async function createEventOperation(
  input: EventMutationPayload,
  {
    api,
    cookieHeader,
    reportError = defaultErrorReporter
  }: EventWriteDependencies
): Promise<EventMutationResult> {
  try {
    const { data } = await api({
      path: "/events",
      method: "POST",
      cookieHeader,
      body: input,
      responseSchema: eventDtoSchema
    });
    return {
      status: "success",
      event: data,
      redirectTo: `/events/${encodeURIComponent(data.slug)}?event=created`
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
    reportError = defaultErrorReporter
  }: EventWriteDependencies
): Promise<EventMutationResult> {
  try {
    const { data } = await api({
      path: `/events/${encodeURIComponent(slug)}`,
      method: "PATCH",
      cookieHeader,
      body: input,
      responseSchema: eventDtoSchema
    });
    return {
      status: "success",
      event: data,
      redirectTo: `/events/${encodeURIComponent(data.slug)}?event=updated`
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
    reportError = defaultErrorReporter
  }: EventWriteDependencies
): Promise<EventRedirectResult> {
  try {
    await api({
      path: `/events/${encodeURIComponent(slug)}`,
      method: "DELETE",
      cookieHeader,
      responseSchema: emptyResponseDtoSchema
    });
    return { redirectTo: "/events?event=cancelled" };
  } catch (error) {
    reportError(error);
    return {
      redirectTo: `/events/${encodeURIComponent(slug)}?event=cancel-failed`
    };
  }
}

export async function eventInterestOperation(
  { slug, interested }: EventInterestInput,
  {
    api,
    cookieHeader,
    unlockHeaders,
    reportError = defaultErrorReporter
  }: EventWriteDependencies
): Promise<EventRedirectResult> {
  try {
    const { data } = await api({
      path: `/events/${encodeURIComponent(slug)}/interest`,
      method: interested ? "POST" : "DELETE",
      cookieHeader,
      headers: unlockHeaders,
      responseSchema: eventDtoSchema
    });
    return {
      redirectTo: `/events/${encodeURIComponent(data.slug)}?event=${
        interested ? "interest-added" : "interest-removed"
      }`
    };
  } catch (error) {
    reportError(error);
    return {
      redirectTo: `/events/${encodeURIComponent(slug)}?event=interest-failed`
    };
  }
}

async function readEventFormViewer({
  api,
  cookieHeader,
  sessionCookieValue,
  reportError
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
      responseSchema: eventFormViewerDtoSchema
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

async function readEventFormResources(
  schoolQuery: string,
  api: ApiClient,
  reportError: (error: unknown) => void
): Promise<
  | {
      status: "ready";
      games: z.output<typeof gamesBrowseResponseDtoSchema>["games"];
      schools: z.output<typeof eventFormSchoolsResponseDtoSchema>["schools"];
      schoolSearchFailed: boolean;
    }
  | { status: "error" }
> {
  const schoolsPromise = schoolQuery.length >= 2
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
        responseSchema: gamesBrowseResponseDtoSchema
      }),
      schoolsPromise
    ]);
    return {
      status: "ready",
      games: games.games,
      schools: schools.schools,
      schoolSearchFailed: schools.failed
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
    responseSchema: eventFormSchoolsResponseDtoSchema
  });
  return data.schools;
}

async function readEvents(api: ApiClient, input: EventsBrowseInput) {
  const search = new URLSearchParams();
  if (input.game) search.set("game", input.game);
  if (input.school) search.set("school", input.school);
  if (input.format) search.set("format", input.format);
  search.set("limit", "25");
  if (input.after) search.set("after", input.after);
  if (input.before) search.set("before", input.before);

  const { data } = await api({
    path: `/events?${search.toString()}`,
    cache: "no-store",
    responseSchema: eventsBrowseResponseDtoSchema
  });
  return data;
}

function defaultErrorReporter(error: unknown): void {
  if (error instanceof ApiContractError) {
    console.error("API response contract violation", {
      path: error.path,
      issues: error.issues
    });
  } else if (!(error instanceof ApiError)) {
    console.error("Event request failed");
  }
}
