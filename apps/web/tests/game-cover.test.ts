import assert from "node:assert/strict";
import test from "node:test";
import { gameCoverResponse } from "../src/server/game-cover.server.js";

const coverURL = "https://cgn.example/api/games/rocket-league/cover";

function coverAPI(respond: (request: Request) => Response) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetcher = (async (input, init) => {
    const request = new Request(input, init);
    calls.push({
      url: request.url,
      headers: Object.fromEntries(request.headers),
    });
    return respond(request);
  }) as typeof fetch;
  return { calls, dependencies: { apiBaseURL: "http://api:8080", fetcher } };
}

test("a cover is served from the site with the API's bytes, type, and ETag", async () => {
  const { calls, dependencies } = coverAPI(
    () =>
      new Response("cover-bytes", {
        headers: {
          "content-type": "image/jpeg",
          etag: '"abc123"',
          "set-cookie": "leak=1",
        },
      }),
  );
  const response = await gameCoverResponse(
    new Request(coverURL, { headers: { cookie: "cgn_session=secret" } }),
    "rocket-league",
    dependencies,
  );

  assert.deepEqual(
    {
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: await response.text(),
      calls,
    },
    {
      status: 200,
      headers: {
        "cache-control": "public, max-age=86400",
        "content-security-policy": "default-src 'none'; sandbox",
        "content-type": "image/jpeg",
        etag: '"abc123"',
        "x-content-type-options": "nosniff",
      },
      body: "cover-bytes",
      // The visitor's cookie is not forwarded.
      calls: [
        { url: "http://api:8080/games/rocket-league/cover", headers: {} },
      ],
    },
  );
});

test("a current ETag revalidates without a body", async () => {
  const { calls, dependencies } = coverAPI(
    () => new Response(null, { status: 304, headers: { etag: '"abc123"' } }),
  );
  const response = await gameCoverResponse(
    new Request(coverURL, { headers: { "if-none-match": '"abc123"' } }),
    "rocket-league",
    dependencies,
  );

  assert.deepEqual(
    {
      status: response.status,
      etag: response.headers.get("etag"),
      body: await response.text(),
      calls,
    },
    {
      status: 304,
      etag: '"abc123"',
      body: "",
      calls: [
        {
          url: "http://api:8080/games/rocket-league/cover",
          headers: { "if-none-match": '"abc123"' },
        },
      ],
    },
  );
});

test("a missing cover is a 404, an API failure a 502, and a bad slug never reaches the API", async () => {
  const missing = coverAPI(() => Response.json({}, { status: 404 }));
  const broken = coverAPI(() => Response.json({}, { status: 500 }));
  const unreachable = coverAPI(() => {
    throw new Error("connection refused");
  });
  const request = new Request(coverURL);

  assert.deepEqual(
    {
      missing: (
        await gameCoverResponse(request, "hidden-game", missing.dependencies)
      ).status,
      broken: (
        await gameCoverResponse(request, "rocket-league", broken.dependencies)
      ).status,
      unreachable: (
        await gameCoverResponse(
          request,
          "rocket-league",
          unreachable.dependencies,
        )
      ).status,
      badSlug: (
        await gameCoverResponse(request, "../admin/v1", missing.dependencies)
      ).status,
      missingCalls: missing.calls.length,
    },
    {
      missing: 404,
      broken: 502,
      unreachable: 502,
      badSlug: 404,
      missingCalls: 1,
    },
  );
});
