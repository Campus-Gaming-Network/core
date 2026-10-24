import { ApiError, type ApiClient } from "../../server/api.server.js";
import { apiErrorReporter } from "../../server/api-error-reporter.server.js";
import { readSchools } from "./catalog-operations.server.js";
import { withBundledSchoolLogo } from "./school-logos.server.js";

const minimumQueryLength = 2;
const maximumQueryLength = 120;
const defaultLimit = 25;
const maximumLimit = 50;

type Dependencies = {
  api: ApiClient;
  reportError?: (error: unknown) => void;
};

export async function schoolsApiResponse(
  request: Request,
  { api, reportError = defaultErrorReporter }: Dependencies,
): Promise<Response> {
  const requestURL = new URL(request.url);
  const query = requestURL.searchParams.get("q")?.trim() ?? "";
  const requestedLimit = Number.parseInt(
    requestURL.searchParams.get("limit") ?? String(defaultLimit),
    10,
  );
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), maximumLimit)
    : defaultLimit;

  if (query.length < minimumQueryLength || query.length > maximumQueryLength) {
    return jsonResponse(request, { error: "invalid_school_query" }, 400);
  }

  try {
    const result = await readSchools(api, { query, limit });
    // Results carry the bundled logo, so the school field can show it.
    const schools = {
      ...result,
      schools: result.schools.map(withBundledSchoolLogo),
    };
    return jsonResponse(request, schools, 200, {
      "cache-control": "private, max-age=60",
    });
  } catch (error) {
    reportError(error);
    const status =
      error instanceof ApiError && error.status < 500 ? error.status : 503;
    return jsonResponse(request, { error: "schools_unavailable" }, status);
  }
}

export function schoolsMethodNotAllowedResponse(): Response {
  return new Response(null, {
    status: 405,
    headers: { allow: "GET, HEAD" },
  });
}

function jsonResponse(
  request: Request,
  body: unknown,
  status: number,
  headers?: HeadersInit,
): Response {
  if (request.method === "HEAD") {
    const responseHeaders = new Headers(headers);
    responseHeaders.set("content-type", "application/json");
    return new Response(null, { status, headers: responseHeaders });
  }
  return Response.json(body, { status, headers });
}

const defaultErrorReporter = apiErrorReporter("School search");
