import assert from "node:assert/strict";
import test from "node:test";
import logoManifest from "../public/school-logos/manifest.json" with { type: "json" };
import { withBundledSchoolLogo } from "../src/features/school-slice/school-logos.server.js";
import {
  homeCatalogOperation,
  schoolCatalogOperation,
  schoolsCatalogOperation,
  schoolStatsOperation,
  schoolViewerStateOperation,
} from "../src/features/school-slice/catalog-operations.server.js";
import { loadSchoolFilterChoices } from "../src/features/school-slice/school-filter.server.js";
import {
  catalogClientStaleTime,
  schoolsBrowseInput,
  validateSchoolsSearch,
} from "../src/features/school-slice/contracts.js";
import {
  homeHead,
  safeSchoolWebsite,
  schoolActivityCounts,
  schoolHead,
  schoolLocation,
  schoolShortName,
} from "../src/features/school-slice/presentation.js";
import {
  ApiError,
  createApiClient,
  type Fetcher,
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
  num_branches: 2,
};
const profile = {
  id: "user-1",
  email: "player@example.com",
  verification_level: "basic",
  name: "Player One",
  timezone: "America/Los_Angeles",
  home_school_id: school.id,
};

function client(fetcher: Fetcher) {
  return createApiClient({ baseUrl: "http://api:8080", fetcher });
}

test("school search normalization is tolerant and keeps notices out of catalog keys", () => {
  const search = validateSchoolsSearch({
    q: ["  example  ", "ignored"],
    state: " CA ",
    page: "2",
    follow: "failed",
    untrusted: { nested: true },
  });

  assert.deepEqual(search, {
    q: "example",
    state: "CA",
    page: 2,
    follow: "failed",
  });
  assert.deepEqual(schoolsBrowseInput(search), {
    query: "example",
    state: "CA",
    page: 2,
  });
  assert.deepEqual(validateSchoolsSearch({ page: "0", follow: "unknown" }), {});
  assert.deepEqual(validateSchoolsSearch({ page: "9007199254740991" }), {});
  assert.equal(catalogClientStaleTime, 300_000);
});

test("home catalog loads the popular schools without the game catalog", async () => {
  const requests: Array<{ path: string; cache?: RequestCache }> = [];
  const api = client(async (input, init) => {
    const path =
      new URL(String(input)).pathname + new URL(String(input)).search;
    requests.push({ path, cache: init?.cache });
    if (path === "/schools?sort=popular&limit=6") {
      return Response.json({
        schools: [{ ...school, internal_note: "strip-me" }],
        limit: 6,
        offset: 0,
        has_more: false,
      });
    }
    throw new Error(`unexpected request ${path}`);
  });

  const result = await homeCatalogOperation({
    api,
    reportError: () => undefined,
  });

  assert.deepEqual(result, {
    schools: [school],
    schoolsPopular: true,
    schoolsUnavailable: false,
  });
  assert.deepEqual(requests, [
    { path: "/schools?sort=popular&limit=6", cache: "no-store" },
  ]);
});

test("school browse builds encoded pagination requests and falls back to an empty page", async () => {
  const requested: string[] = [];
  const stats = {
    slug: school.slug,
    members: 310,
    teams: 18,
    upcoming_events: 0,
  };
  const available = await schoolsCatalogOperation(
    { query: "Cal State", state: "CA", page: 3 },
    {
      api: client(async (input) => {
        requested.push(String(input));
        if (String(input).includes("/school-stats")) {
          return Response.json({ stats: [stats] });
        }
        return Response.json({
          schools: [school],
          limit: 25,
          offset: 50,
          has_more: true,
        });
      }),
    },
  );
  const unavailable = await schoolsCatalogOperation(
    { query: "", state: "", page: 3 },
    {
      api: client(async () => {
        throw new Error("offline");
      }),
      reportError: () => undefined,
    },
  );

  assert.deepEqual(requested, [
    "http://api:8080/schools?q=Cal+State&state=CA&limit=25&offset=50",
    "http://api:8080/school-stats?school=example-university",
  ]);
  assert.deepEqual(available, {
    schools: [school],
    limit: 25,
    offset: 50,
    has_more: true,
    stats: { [school.slug]: stats },
    unavailable: false,
  });
  assert.deepEqual(unavailable, {
    schools: [],
    limit: 25,
    offset: 50,
    has_more: false,
    stats: {},
    unavailable: true,
  });
});

test("school counts that cannot be read leave the rows and the page without them", async () => {
  const reported: unknown[] = [];
  const page = { schools: [school], limit: 25, offset: 0, has_more: false };
  const failingStats = client(async (input) =>
    String(input).includes("/school-stats")
      ? Response.json({ error: "school_stats_unavailable" }, { status: 500 })
      : Response.json(page),
  );
  const stats = {
    slug: school.slug,
    members: 1,
    teams: 0,
    upcoming_events: 2,
  };

  assert.deepEqual(
    {
      browse: await schoolsCatalogOperation(
        { query: "", state: "", page: 1 },
        { api: failingStats, reportError: (error) => reported.push(error) },
      ),
      failed: await schoolStatsOperation(
        { slug: school.slug },
        { api: failingStats, reportError: (error) => reported.push(error) },
      ),
      found: await schoolStatsOperation(
        { slug: school.slug },
        { api: client(async () => Response.json({ stats: [stats] })) },
      ),
      reported: reported.length,
    },
    {
      browse: { ...page, stats: {}, unavailable: false },
      failed: null,
      found: stats,
      reported: 2,
    },
  );
});

test("school counts read as CGN activity and leave out zeros", () => {
  assert.deepEqual(
    [
      schoolActivityCounts({
        slug: "a",
        members: 1310,
        teams: 18,
        upcoming_events: 42,
      }),
      schoolActivityCounts({
        slug: "b",
        members: 1,
        teams: 1,
        upcoming_events: 0,
      }),
      schoolActivityCounts({
        slug: "c",
        members: 0,
        teams: 0,
        upcoming_events: 0,
      }),
    ],
    [
      [
        { kind: "teams", label: "18 teams" },
        { kind: "upcoming_events", label: "42 upcoming events" },
        { kind: "members", label: "1,310 members" },
      ],
      [
        { kind: "teams", label: "1 team" },
        { kind: "members", label: "1 member" },
      ],
      [],
    ],
  );
});

test("school detail strips additive data and distinguishes a true upstream 404", async () => {
  const found = await schoolCatalogOperation(
    { slug: "example university" },
    {
      api: client(async (input, init) => {
        assert.equal(
          String(input),
          "http://api:8080/schools/example%20university",
        );
        assert.equal(new Headers(init?.headers).has("cookie"), false);
        assert.equal(init?.cache, "no-store");
        return Response.json({ ...school, private_token: "never-serialize" });
      }),
    },
  );
  const missing = await schoolCatalogOperation(
    { slug: "missing" },
    {
      api: client(async () =>
        Response.json({ error: "school_not_found" }, { status: 404 }),
      ),
    },
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
      sessionCookieValue: undefined,
    },
  );

  const calls: Array<{
    path: string;
    cache?: RequestCache;
    cookie: string | null;
  }> = [];
  const authenticated = await schoolViewerStateOperation(
    { schoolId: school.id },
    {
      api: client(async (input, init) => {
        const path = new URL(String(input)).pathname;
        calls.push({
          path,
          cache: init?.cache,
          cookie: new Headers(init?.headers).get("cookie"),
        });
        return path === "/me"
          ? Response.json({ ...profile, session: "strip-me" })
          : Response.json({
              schools: [{ ...school, unlock_token: "strip-me" }],
            });
      }),
      cookieHeader: "cgn_session=session-value",
      sessionCookieValue: "session-value",
    },
  );

  assert.deepEqual(anonymous, {
    authenticated: false,
    isHomeSchool: false,
    isFollowing: false,
  });
  assert.equal(anonymousCalls, 0);
  assert.deepEqual(authenticated, {
    authenticated: true,
    isHomeSchool: true,
    isFollowing: true,
  });
  assert.deepEqual(calls, [
    { path: "/me", cache: "no-store", cookie: "cgn_session=session-value" },
    {
      path: "/me/schools",
      cache: "no-store",
      cookie: "cgn_session=session-value",
    },
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
            Response.json({ error: "database_unavailable" }, { status: 503 }),
          ),
          cookieHeader: "cgn_session=value",
          sessionCookieValue: "value",
          reportError: () => undefined,
        },
      ),
    (error: unknown) => error instanceof ApiError && error.status === 503,
  );
});

test("school metadata is dynamic and external website links allow only HTTP(S)", () => {
  const metadata = schoolHead(school, "https://cgn.example");
  assert.ok(
    metadata.meta.some(
      (entry) =>
        entry.property === "og:url" &&
        entry.content === "https://cgn.example/schools/example-university",
    ),
  );
  assert.ok(
    metadata.meta.some(
      (entry) => entry.title === "Example University | Campus Gaming Network",
    ),
  );
  assert.equal(schoolLocation(school), "Irvine, CA");
  assert.deepEqual(
    [
      "Illinois|Illinios|Urbana-Champaign|University of Illinois at Urbana|UIUC|UICU",
      "RPI, Rensselaer",
      "Juilliard",
      "University of St. Mary, University of St Mary",
      "Montefiore New Rochelle Hospital d/b/a Montefiore School of Nursing",
      school.name,
      "",
    ].map((alias) => schoolShortName({ name: school.name, alias })),
    ["UIUC", "RPI", "Juilliard", undefined, undefined, undefined, undefined],
  );
  assert.equal(
    schoolShortName({ ...school, alias: "UIUC|UICU", short_name: "Illinois" }),
    "Illinois",
  );
  assert.equal(
    homeHead("https://cgn.example").meta[0]?.title,
    "Campus Gaming Network",
  );
  assert.equal(safeSchoolWebsite("javascript:alert(1)"), undefined);
  assert.equal(safeSchoolWebsite("not a URL"), undefined);
  assert.equal(
    safeSchoolWebsite("https://example.edu/gaming"),
    "https://example.edu/gaming",
  );
});

test("school pages render only logos served from the configured asset location", async () => {
  const logoBase = "https://assets.example.test";
  const withLogo = (logo_url?: string) => ({ ...school, logo_url });
  const trusted = `${logoBase}/school-logos/school-1/logo.png`;
  const cases = [
    { name: "trusted", logo: trusted, base: logoBase, rendered: true },
    {
      name: "other host",
      logo: "https://evil.example/logo.png",
      base: logoBase,
      rendered: false,
    },
    {
      name: "host-prefix lookalike",
      logo: "https://assets.example.test.evil.example/logo.png",
      base: logoBase,
      rendered: false,
    },
    {
      name: "credentials",
      logo: "https://user:pass@assets.example.test/logo.png",
      base: logoBase,
      rendered: false,
    },
    {
      name: "query string",
      logo: `${trusted}?redirect=1`,
      base: logoBase,
      rendered: false,
    },
    {
      name: "no configured base",
      logo: trusted,
      base: undefined,
      rendered: false,
    },
    { name: "no logo", logo: undefined, base: logoBase, rendered: false },
  ];

  const results = await Promise.all(
    cases.map(({ logo, base }) =>
      schoolCatalogOperation(
        { slug: school.slug },
        {
          api: client(async () => Response.json(withLogo(logo))),
          logoBase: base,
        },
      ),
    ),
  );

  assert.deepEqual(
    results,
    cases.map(({ logo, rendered }) => ({
      status: "found",
      school: rendered ? withLogo(logo) : school,
    })),
  );
});

test("bundled logos require exact seed identity and yield to approved admin uploads", async () => {
  const logo = logoManifest.athletics[0];
  const seededSchool = { ...school, unitid: logo.unitid, slug: logo.slug };
  const assetBase = "https://assets.example.test";
  const adminLogo = `${assetBase}/school-logos/upload.png`;
  const bundled = {
    ...seededSchool,
    logo_url: logo.asset,
    logo_attribution: {
      author: logo.author,
      credit: logo.attribution,
      license: logo.license,
      license_url: logo.license_url,
      source_url: logo.source_url,
    },
  };
  const cases = [
    { input: seededSchool, base: undefined, expected: bundled },
    {
      input: { ...seededSchool, logo_url: adminLogo },
      base: assetBase,
      expected: { ...seededSchool, logo_url: adminLogo },
    },
    {
      input: { ...seededSchool, logo_url: "https://untrusted.test/logo.png" },
      base: assetBase,
      expected: bundled,
    },
    {
      input: { ...seededSchool, slug: "a-different-campus" },
      base: undefined,
      expected: { ...seededSchool, slug: "a-different-campus" },
    },
    {
      input: { ...seededSchool, unitid: undefined },
      base: undefined,
      expected: { ...seededSchool, unitid: undefined },
    },
  ];
  const results = await Promise.all(
    cases.map(({ input, base }) =>
      schoolCatalogOperation(
        { slug: input.slug },
        { api: client(async () => Response.json(input)), logoBase: base },
      ),
    ),
  );
  // Zod omits an undefined JSON property when it parses the upstream payload.
  const { unitid: _unitid, ...withoutUnitID } = seededSchool;
  assert.deepEqual(
    results,
    cases.map(({ expected }, index) => ({
      status: "found",
      school: index === cases.length - 1 ? withoutUnitID : expected,
    })),
  );
});

test("the home page advertises popular schools and falls back to the alphabetical list when there is no ranking", async () => {
  const alphabetical = {
    ...school,
    id: "school-2",
    slug: "alpha-college",
    name: "Alpha College",
  };
  const page = (schools: unknown[]) =>
    Response.json({ schools, limit: 6, offset: 0, has_more: false });
  const cases = [
    {
      name: "a ranking",
      popular: async () => page([school]),
      want: {
        schools: [school],
        schoolsPopular: true,
        schoolsUnavailable: false,
      },
      requests: ["/schools?sort=popular&limit=6"],
    },
    {
      name: "no activity anywhere yet",
      popular: async () => page([]),
      want: {
        schools: [alphabetical],
        schoolsPopular: false,
        schoolsUnavailable: false,
      },
      requests: ["/schools?sort=popular&limit=6", "/schools?limit=6"],
    },
    {
      name: "a ranking that cannot be read",
      popular: async () =>
        Response.json({ error: "schools_unavailable" }, { status: 500 }),
      want: {
        schools: [alphabetical],
        schoolsPopular: false,
        schoolsUnavailable: false,
      },
      requests: ["/schools?sort=popular&limit=6", "/schools?limit=6"],
    },
    {
      name: "a ranking in a shape the page does not accept",
      popular: async () => Response.json({ schools: "not a list" }),
      want: {
        schools: [alphabetical],
        schoolsPopular: false,
        schoolsUnavailable: false,
      },
      requests: ["/schools?sort=popular&limit=6", "/schools?limit=6"],
    },
  ];

  const results = await Promise.all(
    cases.map(async ({ popular }) => {
      const requests: string[] = [];
      const api = client(async (input) => {
        const path = String(input).replace("http://api:8080", "");
        if (path.startsWith("/games")) return Response.json({ games: [] });
        requests.push(path);
        return path.includes("sort=popular") ? popular() : page([alphabetical]);
      });
      const result = await homeCatalogOperation({
        api,
        reportError: () => undefined,
      });
      return {
        schools: result.schools,
        schoolsPopular: result.schoolsPopular,
        schoolsUnavailable: result.schoolsUnavailable,
        requests,
      };
    }),
  );

  assert.deepEqual(
    results,
    cases.map(({ want, requests }) => ({ ...want, requests })),
  );
});

test("the home page says schools are unavailable only when neither list can be read", async () => {
  const result = await homeCatalogOperation({
    api: client(async (input) =>
      String(input).includes("/games")
        ? Response.json({ games: [] })
        : Response.json({ error: "schools_unavailable" }, { status: 503 }),
    ),
    reportError: () => undefined,
  });

  assert.deepEqual(
    {
      schools: result.schools,
      popular: result.schoolsPopular,
      unavailable: result.schoolsUnavailable,
    },
    { schools: [], popular: false, unavailable: true },
  );
});

test("school summaries get a bundled logo by seed slug, except a wordmark", () => {
  const athleticsSlugs = new Set(
    logoManifest.athletics.map((logo) => logo.slug),
  );
  // Between 3:2 and 2:1: shown small only because it is an athletics mark.
  const square = logoManifest.athletics.find(
    (logo) => logo.width / logo.height > 1.5 && logo.width / logo.height <= 2,
  )!;
  // A wordmark with no athletics mark to replace it.
  const wide = logoManifest.logos.find(
    (logo) => logo.width / logo.height > 1.5 && !athleticsSlugs.has(logo.slug),
  )!;
  const summary = (slug: string) => ({ id: "school-1", name: "School", slug });

  assert.deepEqual(
    [square.slug, wide.slug, "not-a-seeded-school"].map((slug) =>
      withBundledSchoolLogo(summary(slug)),
    ),
    [
      {
        ...summary(square.slug),
        logo_url: square.asset,
      },
      summary(wide.slug),
      summary("not-a-seeded-school"),
    ],
  );
});

test("school filter choices name the chosen school and search by query", async () => {
  const requested: string[] = [];
  const api = client(async (input) => {
    const url = String(input);
    requested.push(url);
    return url.includes("?q=")
      ? Response.json({ schools: [school] })
      : Response.json(school);
  });

  const choices = await loadSchoolFilterChoices(
    api,
    { school: school.slug, schoolQuery: "Exam" },
    () => assert.fail("no report expected"),
  );

  assert.deepEqual(requested.sort(), [
    "http://api:8080/schools/example-university",
    "http://api:8080/schools?q=Exam&limit=50",
  ]);
  const option = {
    id: school.id,
    name: school.name,
    slug: school.slug,
    city: school.city,
    state: school.state,
  };
  assert.deepEqual(choices, {
    selectedSchool: withBundledSchoolLogo(option),
    schools: [withBundledSchoolLogo(option)],
    schoolSearchFailed: false,
  });
});

test("school filter choices skip short queries, ignore a missing school, and report a failed search", async () => {
  const reported: unknown[] = [];
  const missing = await loadSchoolFilterChoices(
    client(async () =>
      Response.json({ error: "school_not_found" }, { status: 404 }),
    ),
    { school: "gone", schoolQuery: "a" },
    (error) => reported.push(error),
  );
  assert.deepEqual(missing, { schools: [], schoolSearchFailed: false });
  assert.equal(reported.length, 0);

  const failed = await loadSchoolFilterChoices(
    client(async () => Response.json({ error: "boom" }, { status: 500 })),
    { schoolQuery: "state" },
    (error) => reported.push(error),
  );
  assert.deepEqual(failed, { schools: [], schoolSearchFailed: true });
  assert.equal(reported.length, 1);
});
