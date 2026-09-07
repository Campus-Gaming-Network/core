import { currentProfile } from "../../../lib/server-api";

export const dynamic = "force-dynamic";

export async function GET() {
  let authenticated = false;

  try {
    authenticated = (await currentProfile()) !== null;
  } catch {
    // This endpoint decorates public navigation only. Authenticated pages call
    // currentProfile() directly and continue to surface upstream failures.
  }

  return Response.json(
    { authenticated },
    { headers: { "cache-control": "private, no-store" } }
  );
}
