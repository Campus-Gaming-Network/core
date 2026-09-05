import { ApiError } from "../../../lib/cgn-api";
import { listSchools } from "../../../lib/server-api";

const minimumQueryLength = 2;
const maximumQueryLength = 120;

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  const requestedLimit = Number.parseInt(
    new URL(request.url).searchParams.get("limit") ?? "25",
    10
  );
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), 50)
    : 25;

  if (query.length < minimumQueryLength || query.length > maximumQueryLength) {
    return Response.json(
      { error: "invalid_school_query" },
      { status: 400 }
    );
  }

  try {
    return Response.json(await listSchools({ query, limit }), {
      headers: { "cache-control": "private, max-age=60" }
    });
  } catch (error) {
    const status = error instanceof ApiError && error.status < 500 ? error.status : 503;

    return Response.json(
      { error: "schools_unavailable" },
      { status }
    );
  }
}
