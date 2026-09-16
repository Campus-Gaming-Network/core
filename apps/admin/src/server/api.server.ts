import type * as z from "zod";

export type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export type ApiClient = <TSchema extends z.ZodType>(options: {
  path: string;
  responseSchema: TSchema;
  method?: "GET" | "POST";
  cookieHeader?: string;
  headers?: HeadersInit;
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
  fetcher = fetch
}: {
  baseURL: string;
  proxySecret: string;
  fetcher?: Fetcher;
}): ApiClient {
  return async ({
    path,
    responseSchema,
    method = "GET",
    cookieHeader,
    headers
  }) => {
    const outgoing = new Headers(headers);
    // Never trust browser-supplied internal credentials. This client is the
    // only place the privileged BFF credential is attached.
    outgoing.delete("X-CGN-Admin-Proxy-Secret");
    outgoing.set("X-CGN-Admin-Proxy-Secret", proxySecret);
    if (cookieHeader) outgoing.set("Cookie", cookieHeader);

    const response = await fetcher(buildAPIURL(baseURL, path), {
      method,
      headers: outgoing,
      cache: "no-store",
      redirect: "error"
    });
    const payload = await readPayload(response);
    if (!response.ok) {
      throw new AdminApiError(
        response.status,
        errorCode(payload, response.status)
      );
    }
    const parsed = responseSchema.safeParse(payload);
    if (!parsed.success) throw new AdminApiContractError(path);
    return { data: parsed.data, response };
  };
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
