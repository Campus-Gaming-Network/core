import assert from "node:assert/strict";
import test from "node:test";
import {
  homeCatalogOperation,
  schoolCatalogOperation,
  schoolsCatalogOperation,
  schoolViewerStateOperation
} from "../src/features/school-slice/catalog-operations.server.js";
import {
  catalogClientStaleTime,
  schoolsBrowseInput,
  validateSchoolsSearch
} from "../src/features/school-slice/contracts.js";
import {
  homeHead,
  safeSchoolWebsite,
  schoolHead,
  schoolLocation
} from "../src/features/school-slice/presentation.js";
import {
  ApiError,
  createApiClient,
  type Fetcher
} from "../src/server/api.server.js";

const school = {
  id: "school-1",
  unitid: 123,
  name: "Example University",
  alias: "EU",
  slug: "example-university",
  city: "Irvine",
  state: "CA",
  zip: "92617",
  website_url: "https://example.edu/gaming",
  latitude: 33.64,
  longitude: -117.84,
  is_main_campus: true,
  num_branches: 2
};
const profile = {
  id: "user-1",
  email: "player@example.com",
  verification_level: "basic",
  name: "Player One",
  timezone: "America/Los_Angeles",
  home_school_id: school.id
};

function client(fetcher: Fetcher) {
  return createApiClient({ baseUrl: "http://api:8080", fetcher });
}

test("school search normalization is tolerant and keeps notices out of catalog keys", () => {
  const search = validateSchoolsSearch({
    q: ["  example  ", "ignored"],
    state: " CA ",
    page: "2",
    follow: "added",
    untrusted: { nested: true }
  });

  assert.deepEqual(search, {
    q: "example",
    state: "CA",
    page: 2,
    follow: "added"
  });
  assert.deepEqual(schoolsBrowseInput(search), {
    query: "example",
    state: "CA",
    page: 2
  });
  assert.deepEqual(validateSchoolsSearch({ page: "0", follow: "unknown" }), {});
  assert.deepEqual(validateSchoolsSearch({ page: "9007199254740991" }), {});
  assert.equal(catalogClientStaleTime, 300_000);
});

test("home catalog loads public schools and games independently with safe fallbacks", async () => {
  const requests: Array<{ path: string; cache?: RequestCache }> = [];
  const api = client(async (input, init) => {
    const path = new URL(String(input)).pathname + new URL(String(input)).search;
    requests.push({ path, cache: init?.cache });
    if (path === "/schools?limit=6") {
      return Response.json({
        schools: [{ ...school, internal_note: "strip-me" }],
        limit: 6,
        offset: 0,
        has_more: false
      });
    }
    throw new Error("games unavailable with private connection details");
  });

  const result = await homeCatalogOperation({ api, reportError: () => undefined });

  assert.deepEqual(result.schools, [school]);
  assert.deepEqual(result.games, []);
  assert.equal(result.schoolsUnavailable, false);
  assert.equal(result.gamesUnavailable, true);
  assert.equal(JSON.stringify(result).includes("internal_note"), false);
  assert.deepEqual(requests, [
    { path: "/schools?limit=6", cache: "no-store" },
    { path: "/games", cache: "no-store" }
  ]);
});

test("school browse builds encoded pagination requests and falls back to an empty page", async () => {
  let requested = "";
  const available = await schoolsCatalogOperation(
    { query: "Cal State", state: "CA", page: 3 },
    {
      api: client(async (input) => {
        requested = String(input);
        return Response.json({
          schools: [school],
          limit: 25,
          offset: 50,
          has_more: true
        });
      })
    }
  );
  const unavailable = await schoolsCatalogOperation(
    { query: "", state: "", page: 3 },
    {
      api: client(async () => {
        throw new Error("offline");
      }),
      reportError: () => undefined
    }
  );

  assert.equal(
    requested,
    "http://api:8080/schools?q=Cal+State&state=CA&limit=25&offset=50"
  );
  assert.deepEqual(available, {
    schools: [school],
    limit: 25,
    offset: 50,
    has_more: true,
    unavailable: false
  });
  assert.deepEqual(unavailable, {
    schools: [],
    limit: 25,
    offset: 50,
    has_more: false,
    unavailable: true
  });
});

test("school detail strips additive data and distinguishes a true upstream 404", async () => {
  const found = await schoolCatalogOperation(
    { slug: "example university" },
    {
      api: client(async (input, init) => {
        assert.equal(
          String(input),
          "http://api:8080/schools/example%20university"
        );
        assert.equal(new Headers(init?.headers).has("cookie"), false);
        assert.equal(init?.cache, "no-store");
        return Response.json({ ...school, private_token: "never-serialize" });
      })
    }
  );
  const missing = await schoolCatalogOperation(
    { slug: "missing" },
    {
      api: client(async () =>
        Response.json({ error: "school_not_found" }, { status: 404 })
      )
    }
  );

  assert.deepEqual(found, { status: "found", school });
  assert.equal(JSON.stringify(found).includes("private_token"), false);
  assert.deepEqual(missing, { status: "not_found" });
});

test("viewer follow state is request-scoped, minimal, and skips anonymous upstream work", async () => {
  let anonymousCalls = 0;
  const anonymous = await schoolViewerStateOperation(
    { schoolId: school.id },
    {
      api: client(async () => {
        anonymousCalls += 1;
        return Response.json(profile);
      }),
      cookieHeader: "analytics=value",
      sessionCookieValue: undefined
    }
  );

  const calls: Array<{ path: string; cache?: RequestCache; cookie: string | null }> = [];
  const authenticated = await schoolViewerStateOperation(
    { schoolId: school.id },
    {
      api: client(async (input, init) => {
        const path = new URL(String(input)).pathname;
        calls.push({
          path,
          cache: init?.cache,
          cookie: new Headers(init?.headers).get("cookie")
        });
        return path === "/me"
          ? Response.json({ ...profile, session: "strip-me" })
          : Response.json({ schools: [{ ...school, unlock_token: "strip-me" }] });
      }),
      cookieHeader: "cgn_session=session-value",
      sessionCookieValue: "session-value"
    }
  );

  assert.deepEqual(anonymous, {
    authenticated: false,
    isHomeSchool: false,
    isFollowing: false
  });
  assert.equal(anonymousCalls, 0);
  assert.deepEqual(authenticated, {
    authenticated: true,
    isHomeSchool: true,
    isFollowing: true
  });
  assert.deepEqual(calls, [
    { path: "/me", cache: "no-store", cookie: "cgn_session=session-value" },
    {
      path: "/me/schools",
      cache: "no-store",
      cookie: "cgn_session=session-value"
    }
  ]);
  assert.equal(JSON.stringify(authenticated).includes("session-value"), false);
});

test("viewer failures remain failures rather than false anonymous state", async () => {
  await assert.rejects(
    () =>
      schoolViewerStateOperation(
        { schoolId: school.id },
        {
          api: client(async () =>
            Response.json({ error: "database_unavailable" }, { status: 503 })
          ),
          cookieHeader: "cgn_session=value",
          sessionCookieValue: "value",
          reportError: () => undefined
        }
      ),
    (error: unknown) => error instanceof ApiError && error.status === 503
  );
});

test("school metadata is dynamic and external website links allow only HTTP(S)", () => {
  const metadata = schoolHead(school, "https://cgn.example");
  assert.ok(
    metadata.meta.some(
      (entry) =>
        entry.property === "og:url" &&
        entry.content === "https://cgn.example/schools/example-university"
    )
  );
  assert.ok(
    metadata.meta.some(
      (entry) => entry.title === "Example University | Campus Gaming Network"
    )
  );
  assert.equal(schoolLocation(school), "Irvine, CA");
  assert.equal(homeHead("https://cgn.example").meta[0]?.title, "Campus Gaming Network");
  assert.equal(safeSchoolWebsite("javascript:alert(1)"), undefined);
  assert.equal(safeSchoolWebsite("not a URL"), undefined);
  assert.equal(
    safeSchoolWebsite("https://example.edu/gaming"),
    "https://example.edu/gaming"
  );
});
