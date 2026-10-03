import {
  ApiContractError,
  ApiError,
  type ApiClient,
} from "../../server/api.server.js";
import {
  peopleListDtoSchema,
  peoplePageSize,
  type EventAttendeesInput,
  type PeopleListResult,
  type SchoolMembersInput,
  type TeamMembersInput,
} from "./contracts.js";

type Dependencies = {
  api: ApiClient;
  /** The viewer's session cookie alone; empty for a visitor. */
  cookieHeader: string;
  reportError?: (error: unknown) => void;
};

type EventDependencies = Dependencies & {
  /** Proves a private event was unlocked. */
  unlockHeaders?: HeadersInit;
};

type PeopleQuery = {
  response?: string;
  limit?: number;
  after?: string;
  before?: string;
};

export async function eventAttendeesOperation(
  { slug, response, limit, after, before }: EventAttendeesInput,
  dependencies: EventDependencies,
): Promise<PeopleListResult> {
  return readPeople(
    `/events/${encodeURIComponent(slug)}/attendees`,
    { response, limit, after, before },
    dependencies,
  );
}

export async function schoolMembersOperation(
  { slug, limit, after, before }: SchoolMembersInput,
  dependencies: Dependencies,
): Promise<PeopleListResult> {
  return readPeople(
    `/schools/${encodeURIComponent(slug)}/members`,
    { limit, after, before },
    dependencies,
  );
}

export async function teamMembersOperation(
  { slug, limit, after, before }: TeamMembersInput,
  dependencies: Dependencies,
): Promise<PeopleListResult> {
  return readPeople(
    `/teams/${encodeURIComponent(slug)}/members`,
    { limit, after, before },
    dependencies,
  );
}

/**
 * Lists are for signed-in viewers, so a request with no session never reaches
 * the API. A 401 means the session is no longer valid and reads the same way.
 * A 404 covers a missing entity and a private event the viewer has not
 * unlocked, which the API does not tell apart.
 */
async function readPeople(
  path: string,
  { response, limit = peoplePageSize, after, before }: PeopleQuery,
  {
    api,
    cookieHeader,
    unlockHeaders,
    reportError = defaultErrorReporter,
  }: EventDependencies,
): Promise<PeopleListResult> {
  if (!cookieHeader) return { status: "signed_out" };

  const search = new URLSearchParams();
  if (response) search.set("response", response);
  search.set("limit", String(limit));
  if (after) search.set("after", after);
  if (before) search.set("before", before);

  try {
    const { data } = await api({
      path: `${path}?${search.toString()}`,
      cookieHeader,
      headers: unlockHeaders,
      cache: "no-store",
      responseSchema: peopleListDtoSchema,
    });
    return { status: "found", list: data };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return { status: "signed_out" };
    }
    if (error instanceof ApiError && error.status === 404) {
      return { status: "not_found" };
    }
    reportError(error);
    return { status: "unavailable" };
  }
}

function defaultErrorReporter(error: unknown): void {
  if (error instanceof ApiContractError) {
    console.error("People list response contract violation", {
      path: error.path,
      issues: error.issues,
    });
  } else if (!(error instanceof ApiError)) {
    console.error("People list request failed");
  }
}
