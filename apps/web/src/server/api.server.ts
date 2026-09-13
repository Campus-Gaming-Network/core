import type * as z from "zod";

export type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export type ApiRequestOptions<TSchema extends z.ZodType> = {
  path: string;
  responseSchema: TSchema;
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  cookieHeader?: string;
  headers?: HeadersInit;
  cache?: RequestCache;
};

export type ApiResult<T> = {
  data: T;
  response: Response;
};

export type ApiClient = <TSchema extends z.ZodType>(
  options: ApiRequestOptions<TSchema>
) => Promise<ApiResult<z.output<TSchema>>>;

export type ApiClientDependencies = {
  baseUrl: string;
  fetcher?: Fetcher;
  prepareHeaders?: (headers: Headers) => Headers;
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

export class ApiContractError extends Error {
  readonly path: string;
  readonly issues: ReadonlyArray<{
    code: string;
    message: string;
    path: PropertyKey[];
  }>;

  constructor(
    path: string,
    issues: ReadonlyArray<{
      code: string;
      message: string;
      path: PropertyKey[];
    }>
  ) {
    super(`API response did not match its contract for ${path}`);
    this.name = "ApiContractError";
    this.path = path;
    this.issues = issues;
  }
}

export function createApiClient({
  baseUrl,
  fetcher = fetch,
  prepareHeaders = (headers) => headers
}: ApiClientDependencies): ApiClient {
  return async <TSchema extends z.ZodType>({
    path,
    responseSchema,
    method = "GET",
    body,
    cookieHeader,
    headers,
    cache = "no-store"
  }: ApiRequestOptions<TSchema>): Promise<ApiResult<z.output<TSchema>>> => {
    const outgoingHeaders = prepareHeaders(new Headers(headers));

    if (body !== undefined && !outgoingHeaders.has("content-type")) {
      outgoingHeaders.set("content-type", "application/json");
    }
    if (cookieHeader) {
      outgoingHeaders.set("cookie", cookieHeader);
    }

    const response = await fetcher(buildApiUrl(baseUrl, path), {
      method,
      headers: outgoingHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache
    });
    const payload = await readPayload(response);

    if (!response.ok) {
      throw new ApiError(response.status, errorCode(payload, response.status));
    }

    const parsed = responseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new ApiContractError(
        path,
        parsed.error.issues.map(({ code, message, path: issuePath }) => ({
          code,
          message,
          path: issuePath
        }))
      );
    }

    return { data: parsed.data, response };
  };
}

export function buildApiUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}

export function safeApiErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return "Something went wrong. Please try again.";
  }

  const messages: Record<string, string> = {
    authentication_required: "Please log in to continue.",
    database_unavailable: "The service is starting up. Try again in a moment.",
    email_not_verified: "Please verify your email before logging in.",
    event_full: "That event is full.",
    event_not_found: "That event could not be found.",
    event_rsvp_closed: "RSVPs are closed for that event.",
    event_rsvp_email_failed:
      "Your RSVP was saved, but we could not send the confirmation email.",
    event_rsvp_failed: "We could not save your RSVP. Please try again.",
    event_unlock_failed: "We could not unlock that event. Please try again.",
    invalid_credentials: "The email or password did not match.",
    invalid_private_password: "That event password did not match.",
    invalid_request: "Check the form fields and try again.",
    private_event_locked: "Unlock that private event before RSVPing.",
    rate_limited: "Too many attempts. Give it a minute, then try again."
  };

  return messages[error.code] ?? "Something went wrong. Please try again.";
}

async function readPayload(response: Response): Promise<unknown> {
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

function errorCode(payload: unknown, status: number): string {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "string"
  ) {
    return payload.error;
  }

  return `http_${status}`;
}
