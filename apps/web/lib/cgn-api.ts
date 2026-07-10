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

export type SchoolsResponse = {
  schools: School[];
  limit: number;
  offset: number;
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
  bio?: string;
  timezone: string;
  home_school_id: string;
  social_links?: SocialLink[];
};

export type PublicProfile = {
  id: string;
  name: string;
  bio?: string;
  verification_level: string;
  home_school_id: string;
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

export function userMessageForApiError(error: unknown) {
  if (!(error instanceof ApiError)) {
    return "Something went wrong. Please try again.";
  }

  const messages: Record<string, string> = {
    authentication_required: "Please log in to continue.",
    database_unavailable: "The service is starting up. Try again in a moment.",
    email_already_registered: "That email already has an account.",
    email_not_verified: "Please verify your email before logging in.",
    home_school_not_found: "Choose an active home school from the list.",
    invalid_credentials: "The email or password did not match.",
    invalid_id: "That profile link is not valid.",
    invalid_or_expired_token: "That link is invalid or has expired.",
    invalid_request: "Check the form fields and try again.",
    rate_limited: "Too many attempts. Give it a minute, then try again.",
    school_not_found: "That school could not be found.",
    user_not_found: "That profile could not be found."
  };

  return messages[error.code] ?? "Something went wrong. Please try again.";
}
