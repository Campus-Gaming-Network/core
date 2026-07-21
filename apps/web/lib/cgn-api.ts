export type School = {
  id: string;
  unitid?: number;
  name: string;
  alias?: string;
  slug: string;
  city?: string;
  state?: string;
  zip?: string;
  website_url?: string;
  latitude?: number;
  longitude?: number;
  is_main_campus: boolean;
  num_branches: number;
};

export type SchoolSummary = Pick<
  School,
  "id" | "name" | "slug" | "city" | "state"
>;

export type SchoolsResponse = {
  schools: School[];
  limit: number;
  offset: number;
};

export type FollowedSchoolsResponse = {
  schools: School[];
};

export type Game = {
  id: string;
  name: string;
  slug: string;
  cover_url?: string;
};

export type GamesResponse = {
  games: Game[];
};

export type GameSummary = Pick<Game, "id" | "name" | "slug">;

export type EventVisibility = "public" | "unlisted" | "private";

export type EventFormat = "online" | "in_person" | "hybrid";

export type EventLifecycle =
  | "upcoming"
  | "happening_now"
  | "ended"
  | "full";

export type EventRSVP = "yes" | "maybe" | "no";

export type Event = {
  id: string;
  title: string;
  slug: string;
  description: string;
  visibility: EventVisibility;
  format: EventFormat;
  starts_at: string;
  ends_at: string;
  timezone: string;
  location_name?: string;
  address?: string;
  online_url?: string;
  capacity?: number;
  rsvp_yes_count: number;
  interest_count: number;
  lifecycle: EventLifecycle;
  is_paid: boolean;
  payment_note?: string;
  payment_url?: string;
  host_school: SchoolSummary;
  games: GameSummary[];
  viewer_rsvp?: EventRSVP;
  viewer_interested?: boolean;
  viewer_can_edit?: boolean;
};

export type LockedEvent = {
  slug: string;
  visibility: "private";
  locked: true;
};

export type EventDetail = Event | LockedEvent;

export type EventsResponse = {
  events: Event[];
  limit: number;
  offset: number;
};

export type DashboardEventsResponse = {
  upcoming_rsvps: Event[];
  followed_school_events: Event[];
};

export type TeamRole = "owner" | "captain" | "member";

export type TeamMember = {
  user_id: string;
  name: string;
  role: TeamRole;
};

export type Team = {
  id: string;
  name: string;
  slug: string;
  description: string;
  owner_user_id: string;
  member_count: number;
  school?: SchoolSummary;
  games: GameSummary[];
  viewer_role?: TeamRole;
  members?: TeamMember[];
};

export type TeamsResponse = {
  teams: Team[];
  limit: number;
  offset: number;
};

export type EventUnlockResponse = {
  event: Event;
  unlock_token: string;
  expires_at: string;
};

export type SocialLink = {
  id?: string;
  label: string;
  url: string;
};

export type Profile = {
  id: string;
  email: string;
  email_verified_at?: string;
  verification_level: string;
  name: string;
  avatar_url?: string;
  bio?: string;
  timezone: string;
  home_school_id: string;
  home_school?: SchoolSummary;
  social_links?: SocialLink[];
};

export type PublicProfile = {
  id: string;
  name: string;
  avatar_url?: string;
  bio?: string;
  verification_level: string;
  home_school_id: string;
  home_school?: SchoolSummary;
  social_links?: SocialLink[];
};

export type ApiResult<T> = {
  data: T;
  response: Response;
};

export type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

type ApiRequestOptions = {
  path: string;
  method?: string;
  body?: unknown;
  cookieHeader?: string;
  cache?: RequestCache;
  headers?: HeadersInit;
  fetcher?: Fetcher;
  baseUrl?: string;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

type ErrorPayload = {
  error?: unknown;
};

export function apiBaseUrl() {
  return process.env.API_INTERNAL_URL ?? "http://localhost:8080";
}

export function buildApiUrl(baseUrl: string, path: string) {
  const base = baseUrl.replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;

  return `${base}${suffix}`;
}

export async function apiRequest<T>({
  path,
  method = "GET",
  body,
  cookieHeader,
  cache = "no-store",
  headers,
  fetcher = fetch,
  baseUrl = apiBaseUrl()
}: ApiRequestOptions): Promise<ApiResult<T>> {
  const requestHeaders = new Headers(headers);

  if (body !== undefined && !requestHeaders.has("content-type")) {
    requestHeaders.set("content-type", "application/json");
  }
  if (cookieHeader) {
    requestHeaders.set("cookie", cookieHeader);
  }

  const response = await fetcher(buildApiUrl(baseUrl, path), {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache
  });

  const payload = await readPayload(response);

  if (!response.ok) {
    throw new ApiError(response.status, errorCode(payload, response.status));
  }

  return {
    data: payload as T,
    response
  };
}

async function readPayload(response: Response) {
  if (response.status === 204) {
    return undefined;
  }

  const text = await response.text();
  if (text.trim() === "") {
    return undefined;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function errorCode(payload: unknown, status: number) {
  if (isErrorPayload(payload) && typeof payload.error === "string") {
    return payload.error;
  }

  return `http_${status}`;
}

function isErrorPayload(payload: unknown): payload is ErrorPayload {
  return typeof payload === "object" && payload !== null && "error" in payload;
}

type SameSite = "lax" | "strict" | "none";

export type ParsedSessionCookie = {
  name: string;
  value: string;
  path?: string;
  expires?: Date;
  maxAge?: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: SameSite;
};

export function getSetCookieHeader(headers: Headers) {
  const headersWithSetCookie = headers as Headers & {
    getSetCookie?: () => string[];
  };
  const values = headersWithSetCookie.getSetCookie?.();

  if (values && values.length > 0) {
    return values[0];
  }

  return headers.get("set-cookie");
}

export function parseSetCookie(
  header: string | null | undefined,
  expectedName?: string
): ParsedSessionCookie | null {
  if (!header) {
    return null;
  }

  const parts = header.split(";").map((part) => part.trim());
  const [nameValue, ...attributes] = parts;
  const separatorIndex = nameValue.indexOf("=");

  if (separatorIndex < 1) {
    return null;
  }

  const name = nameValue.slice(0, separatorIndex);
  const value = nameValue.slice(separatorIndex + 1);

  if (expectedName && name !== expectedName) {
    return null;
  }

  const parsed: ParsedSessionCookie = {
    name,
    value,
    httpOnly: false,
    secure: false
  };

  for (const attribute of attributes) {
    const attributeSeparator = attribute.indexOf("=");
    const key = (
      attributeSeparator === -1
        ? attribute
        : attribute.slice(0, attributeSeparator)
    ).toLowerCase();
    const rawValue =
      attributeSeparator === -1 ? "" : attribute.slice(attributeSeparator + 1);

    if (key === "path") {
      parsed.path = rawValue;
    } else if (key === "expires") {
      const expires = new Date(rawValue);
      if (!Number.isNaN(expires.getTime())) {
        parsed.expires = expires;
      }
    } else if (key === "max-age") {
      const maxAge = Number.parseInt(rawValue, 10);
      if (Number.isFinite(maxAge)) {
        parsed.maxAge = maxAge;
      }
    } else if (key === "httponly") {
      parsed.httpOnly = true;
    } else if (key === "secure") {
      parsed.secure = true;
    } else if (key === "samesite") {
      const sameSite = rawValue.toLowerCase();
      if (
        sameSite === "lax" ||
        sameSite === "strict" ||
        sameSite === "none"
      ) {
        parsed.sameSite = sameSite;
      }
    }
  }

  return parsed;
}

export function formString(formData: FormData, key: string) {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
}

export function formCheckbox(formData: FormData, key: string) {
  return formData.get(key) === "on";
}

export function isSchoolFollowed(schools: School[], schoolID: string) {
  return schools.some((school) => school.id === schoolID);
}

export function schoolLocation(
  school: Pick<SchoolSummary, "city" | "state">,
  fallback = "Location pending"
) {
  return [school.city, school.state].filter(Boolean).join(", ") || fallback;
}

export function publicProfileHomeSchool(profile: PublicProfile) {
  if (profile.home_school) {
    return {
      name: profile.home_school.name,
      location: schoolLocation(profile.home_school, ""),
      href: `/schools/${profile.home_school.slug}`
    };
  }

  return {
    name: profile.home_school_id,
    location: "",
    href: undefined
  };
}

export function userInitials(name: string) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => Array.from(part)[0]?.toUpperCase() ?? "")
    .join("");

  return initials || "CG";
}

export function isLockedEvent(event: EventDetail): event is LockedEvent {
  return "locked" in event && event.locked === true;
}

export function eventLocation(event: Pick<Event, "format" | "location_name" | "address" | "online_url">) {
  if (event.format === "online") {
    return event.online_url ? "Online" : "Online details pending";
  }

  const inPersonLocation = [event.location_name, event.address]
    .filter(Boolean)
    .join(" · ");

  if (event.format === "hybrid") {
    return inPersonLocation
      ? `${inPersonLocation} + online`
      : "Hybrid details pending";
  }

  return inPersonLocation || "Location pending";
}

export function eventLifecycleLabel(lifecycle: EventLifecycle) {
  const labels: Record<EventLifecycle, string> = {
    ended: "Ended",
    full: "Full",
    happening_now: "Happening now",
    upcoming: "Upcoming"
  };

  return labels[lifecycle];
}

export function eventVisibilityLabel(visibility: EventVisibility) {
  const labels: Record<EventVisibility, string> = {
    private: "Private",
    public: "Public",
    unlisted: "Unlisted"
  };

  return labels[visibility];
}

export function eventFormatLabel(format: EventFormat) {
  const labels: Record<EventFormat, string> = {
    hybrid: "Hybrid",
    in_person: "In person",
    online: "Online"
  };

  return labels[format];
}

export function eventRSVPLabel(response: EventRSVP) {
  const labels: Record<EventRSVP, string> = {
    maybe: "Maybe",
    no: "No",
    yes: "Yes"
  };

  return labels[response];
}

export function teamRoleLabel(role: TeamRole) {
  const labels: Record<TeamRole, string> = {
    captain: "Captain",
    member: "Member",
    owner: "Owner"
  };

  return labels[role];
}

export function eventTimeRange(event: Pick<Event, "starts_at" | "ends_at" | "timezone">) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: event.timezone
  });

  return `${formatter.format(new Date(event.starts_at))} – ${formatter.format(
    new Date(event.ends_at)
  )}`;
}

export function userMessageForApiError(error: unknown) {
  if (!(error instanceof ApiError)) {
    return "Something went wrong. Please try again.";
  }

  const messages: Record<string, string> = {
    authentication_required: "Please log in to continue.",
    cannot_report_self: "You cannot report your own profile.",
    database_unavailable: "The service is starting up. Try again in a moment.",
    email_already_registered: "That email already has an account.",
    email_not_verified: "Please verify your email before logging in.",
    event_create_failed: "We could not create that event. Please try again.",
    event_delete_failed: "We could not delete that event. Please try again.",
    event_full: "That event is full.",
    event_interest_failed: "We could not update your interest in that event.",
    event_not_found: "That event could not be found.",
    event_rsvp_closed: "RSVPs are closed for that event.",
    event_rsvp_email_failed: "Your RSVP was saved, but we could not send the confirmation email.",
    event_rsvp_failed: "We could not save your RSVP. Please try again.",
    event_slug_unavailable: "That event URL is unavailable. Try changing the title or start time.",
    event_unlock_failed: "We could not unlock that event. Please try again.",
    event_update_failed: "We could not update that event. Please try again.",
    game_not_found: "Choose at least one active game from the list.",
    home_school_not_found: "Choose an active home school from the list.",
    host_school_not_found: "Choose an active host school from the list.",
    invalid_credentials: "The email or password did not match.",
    invalid_id: "That profile link is not valid.",
    invalid_private_password: "That event password did not match.",
    invalid_team_password: "That team password did not match.",
    invalid_team_role: "Choose a valid team member and role.",
    invalid_or_expired_token: "That link is invalid or has expired.",
    invalid_request: "Check the form fields and try again.",
    not_event_organizer: "Only event organizers can change that event.",
    private_event_locked: "Unlock that private event before RSVPing.",
    rate_limited: "Too many attempts. Give it a minute, then try again.",
    report_failed: "We could not submit that report. Please try again.",
    report_target_not_found: "That report target could not be found.",
    school_not_found: "That school could not be found.",
    support_ticket_failed: "We could not submit that support ticket. Please try again.",
    not_team_owner: "Only the team owner can manage members.",
    team_captain_failed: "We could not update that captain role. Please try again.",
    team_create_failed: "We could not create that team. Please try again.",
    team_game_not_found: "Choose at least one active game from the list.",
    team_join_failed: "We could not join that team. Please try again.",
    team_member_not_found: "Choose an active team member.",
    team_not_found: "That team could not be found.",
    team_school_not_found: "Choose an active school for that team.",
    team_slug_unavailable: "That team URL is unavailable. Try changing the name.",
    team_transfer_failed: "We could not transfer ownership. Please try again.",
    user_not_found: "That profile could not be found."
  };

  return messages[error.code] ?? "Something went wrong. Please try again.";
}
