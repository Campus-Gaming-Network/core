import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import {
  analyticsEventResponse,
  analyticsScriptResponse,
  cleanEvent,
  resetAnalyticsScriptCache,
  sendAnalyticsGoal,
} from "../src/server/analytics.server.js";
import { environmentValidationIssues } from "../src/server/environment.server.js";

const site = "https://staging.campusgamingnetwork.com";
const environment: Record<string, string> = {
  PLAUSIBLE_DOMAIN: "staging.campusgamingnetwork.com",
};

test("an event loses query strings except campaign tags and always names our site", () => {
  assert.deepEqual(
    cleanEvent(
      JSON.stringify({
        n: "pageview",
        u: `${site}/auth/reset-password?token=secret&utm_source=newsletter`,
        d: "someone-else.example",
        r: `${site}/club-editor-invite?token=other-secret`,
        w: 1280,
      }),
      site,
      "staging.campusgamingnetwork.com",
    ),
    {
      n: "pageview",
      u: `${site}/auth/reset-password?utm_source=newsletter`,
      d: "staging.campusgamingnetwork.com",
      r: `${site}/club-editor-invite`,
      w: 1280,
    },
  );
  for (const body of [
    "not json",
    "[]",
    JSON.stringify({ n: "pageview", u: "https://elsewhere.example/" }),
    JSON.stringify({ n: "pageview", u: "javascript:alert(1)" }),
    JSON.stringify({ u: `${site}/` }),
  ]) {
    assert.equal(
      cleanEvent(body, site, "staging.campusgamingnetwork.com"),
      undefined,
      body,
    );
  }
});

test("events go to Plausible from our pages only, with the visitor's address and agent", async () => {
  const forwarded: Array<{
    url: string;
    headers: Record<string, string>;
    body: unknown;
  }> = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    forwarded.push({
      url: String(input),
      headers: Object.fromEntries(new Headers(init?.headers)),
      body: JSON.parse(String(init?.body)),
    });
    return new Response("ok", { status: 202 });
  }) as typeof fetch;
  const post = (
    origin: string,
    dependencies = { environment, fetcher, siteOrigin: site },
  ) =>
    analyticsEventResponse(
      new Request(`${site}/insights/event`, {
        method: "POST",
        headers: {
          origin,
          "user-agent": "Test Browser",
          "cf-connecting-ip": "203.0.113.7",
          "x-forwarded-for": "198.51.100.1, 10.0.0.1",
        },
        body: JSON.stringify({
          n: "pageview",
          u: `${site}/clubs?q=smash`,
          d: "x",
          r: null,
        }),
      }),
      dependencies,
    );

  const statuses = [
    (await post(site)).status,
    (await post("https://evil.example")).status,
    (await post(site, { environment: {}, fetcher, siteOrigin: site })).status,
  ];
  assert.deepEqual(statuses, [202, 403, 404]);
  assert.deepEqual(forwarded, [
    {
      url: "https://plausible.io/api/event",
      headers: {
        "content-type": "application/json",
        "user-agent": "Test Browser",
        "x-forwarded-for": "203.0.113.7",
      },
      body: {
        n: "pageview",
        u: `${site}/clubs`,
        d: "staging.campusgamingnetwork.com",
        r: null,
      },
    },
  ]);
});

test("the script is fetched once and kept, and a failed refresh serves the old copy", async () => {
  resetAnalyticsScriptCache();
  let clock = 0;
  const responses = [
    new Response("script v1"),
    new Response("down", { status: 503 }),
  ];
  let fetches = 0;
  const fetcher = (async () => {
    fetches += 1;
    return responses.shift() ?? new Response("unexpected");
  }) as unknown as typeof fetch;
  const read = async () => {
    const response = await analyticsScriptResponse({
      environment,
      fetcher,
      now: () => clock,
    });
    return [
      response.status,
      await response.text(),
      response.headers.get("content-type"),
    ];
  };

  const first = await read();
  const cached = await read();
  clock = 7 * 60 * 60 * 1000;
  const stale = await read();
  const off = await analyticsScriptResponse({ environment: {}, fetcher });

  assert.deepEqual(
    { first, cached, stale, fetches, off: off.status },
    {
      first: [200, "script v1", "application/javascript; charset=utf-8"],
      cached: [200, "script v1", "application/javascript; charset=utf-8"],
      stale: [200, "script v1", "application/javascript; charset=utf-8"],
      fetches: 2,
      off: 404,
    },
  );
});

test("PLAUSIBLE_DOMAIN must be a hostname when set", () => {
  const base = { DEPLOYMENT_ENV: "local" };
  assert.deepEqual(
    [
      environmentValidationIssues(base),
      environmentValidationIssues({
        ...base,
        PLAUSIBLE_DOMAIN: "Staging.CampusGamingNetwork.com",
      }),
      environmentValidationIssues({
        ...base,
        PLAUSIBLE_DOMAIN: "https://campusgamingnetwork.com/",
      }),
    ],
    [
      [],
      [],
      ["PLAUSIBLE_DOMAIN must be a hostname such as campusgamingnetwork.com"],
    ],
  );
});

function visitor(referer: string) {
  return {
    headers: new Headers({
      referer,
      "user-agent": "Test Browser",
      "cf-connecting-ip": "203.0.113.7",
    }),
  };
}

test("a goal names the form's page and the visitor, and is never sent unconfigured or allowed to throw", async () => {
  const sent: Array<{
    url: string;
    headers: Record<string, string>;
    body: unknown;
  }> = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({
      url: String(input),
      headers: Object.fromEntries(new Headers(init?.headers)),
      body: JSON.parse(String(init?.body)),
    });
    return new Response("ok", { status: 202 });
  }) as typeof fetch;
  await sendAnalyticsGoal(
    { name: "RSVP", response: "yes" },
    visitor(`${site}/events/lan-night?event=unlocked&utm_source=discord`),
    { environment, fetcher, siteOrigin: site },
  );
  await sendAnalyticsGoal(
    { name: "Signup" },
    visitor("https://elsewhere.example/signup"),
    { environment, fetcher, siteOrigin: site },
  );
  await sendAnalyticsGoal({ name: "Join club" }, visitor(`${site}/clubs/a`), {
    environment: {},
    fetcher,
    siteOrigin: site,
  });
  await sendAnalyticsGoal({ name: "Join club" }, visitor(`${site}/clubs/a`), {
    environment,
    fetcher: (async () => {
      throw new Error("offline");
    }) as typeof fetch,
    siteOrigin: site,
  });

  const headers = {
    "content-type": "application/json",
    "user-agent": "Test Browser",
    "x-forwarded-for": "203.0.113.7",
  };
  assert.deepEqual(sent, [
    {
      url: "https://plausible.io/api/event",
      headers,
      body: {
        n: "RSVP",
        u: `${site}/events/lan-night?utm_source=discord`,
        d: "staging.campusgamingnetwork.com",
        r: null,
        p: { response: "yes" },
      },
    },
    {
      url: "https://plausible.io/api/event",
      headers,
      body: {
        n: "Signup",
        u: `${site}/`,
        d: "staging.campusgamingnetwork.com",
        r: null,
      },
    },
  ]);
});
