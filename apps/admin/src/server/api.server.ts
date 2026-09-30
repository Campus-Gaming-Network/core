import type * as z from "zod";

export type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type ApiClient = <TSchema extends z.ZodType>(options: {
  path: string;
  responseSchema: TSchema;
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  cookieHeader?: string;
  headers?: HeadersInit;
  /**
   * The Access identity this server verified for the request. The API binds a
   * session to the identity it was issued to, so it refuses a session request
   * that does not carry it.
   */
  accessEmail?: string;
}) => Promise<{ data: z.output<TSchema>; response: Response }>;

export class AdminApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = "AdminApiError";
    this.status = status;
    this.code = code;
  }
}

export class AdminApiContractError extends Error {
  readonly path: string;

  constructor(path: string) {
    super(`Admin API response did not match its contract for ${path}`);
    this.name = "AdminApiContractError";
    this.path = path;
  }
}

export function createAdminApiClient({
  baseURL,
  proxySecret,
  fetcher = fetch,
}: {
  baseURL: string;
  proxySecret: string;
  fetcher?: Fetcher;
}): ApiClient {
  return async ({
    path,
    responseSchema,
    method = "GET",
    body,
    cookieHeader,
    headers,
    accessEmail,
  }) => {
    const outgoing = new Headers(headers);
    // Never trust browser-supplied internal credentials. This client is the
    // only place the privileged BFF credential and the verified identity are
    // attached.
    outgoing.delete("X-CGN-Admin-Proxy-Secret");
    outgoing.set("X-CGN-Admin-Proxy-Secret", proxySecret);
    outgoing.delete("X-CGN-Admin-Access-Email");
    if (accessEmail) outgoing.set("X-CGN-Admin-Access-Email", accessEmail);
    if (cookieHeader) outgoing.set("Cookie", cookieHeader);
    // A FormData body is sent as multipart; fetch supplies its boundary.
    const multipart = body instanceof FormData;
    if (body !== undefined && !multipart) {
      outgoing.set("Content-Type", "application/json");
    }

    const response = await fetcher(buildAPIURL(baseURL, path), {
      method,
      body: multipart
        ? body
        : body === undefined
          ? undefined
          : JSON.stringify(body),
      headers: outgoing,
      cache: "no-store",
      redirect: "error",
    });
    const payload = await readPayload(response);
    if (!response.ok) {
      throw new AdminApiError(
        response.status,
        errorCode(payload, response.status),
      );
    }
    const parsed = responseSchema.safeParse(payload);
    if (!parsed.success) throw new AdminApiContractError(path);
    return { data: parsed.data, response };
  };
}

/**
 * Wraps an API client so every call carries the Access identity verified for
 * the current browser request. The identity is verified once, on first use. If
 * it cannot be verified the call fails as an ended session and never reaches
 * the API, so a session cookie alone authorizes nothing.
 */
export function withAccessIdentity(
  api: ApiClient,
  verify: () => Promise<{ email: string } | undefined>,
): ApiClient {
  let outcome:
    | Promise<{ identity?: { email: string } } | { error: unknown }>
    | undefined;
  return (async (options) => {
    outcome ??= verify().then(
      (identity) => ({ identity }),
      (error: unknown) => ({ error }),
    );
    const result = await outcome;
    if ("error" in result) {
      throw new AdminApiError(401, "admin_access_identity_invalid");
    }
    return api({ ...options, accessEmail: result.identity?.email });
  }) as ApiClient;
}

function buildAPIURL(baseURL: string, path: string): string {
  return `${baseURL.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

async function readPayload(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const text = await response.text();
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function errorCode(payload: unknown, status: number): string {
  return payload !== null &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof payload.error === "string"
    ? payload.error
    : `http_${status}`;
}
