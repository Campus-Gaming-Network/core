import assert from "node:assert/strict";
import test from "node:test";
import {
  robotsTxtResponse,
  sitemapXmlResponse,
} from "../src/features/seo-slice/seo.server.js";
import type { ApiClient } from "../src/server/api.server.js";

const publicOrigin = "https://cgn.example";

function apiReturning(data: unknown): { api: ApiClient; paths: string[] } {
  const paths: string[] = [];
  const api: ApiClient = async ({ path, responseSchema }) => {
    paths.push(path);
    return {
      data: responseSchema.parse(data),
      response: new Response(null),
    } as never;
  };
  return { api, paths };
}

test("robots.txt opens production to crawlers, points to the sitemap, and closes everything else", async () => {
  const production = robotsTxtResponse({
    deploymentEnvironment: "production",
    publicOrigin,
  });
  const staging = robotsTxtResponse({
    deploymentEnvironment: "staging",
    publicOrigin,
  });

  assert.equal(
    await production.text(),
    "User-agent: *\nDisallow: /api/\n\nSitemap: https://cgn.example/sitemap.xml\n",
  );
  assert.equal(await staging.text(), "User-agent: *\nDisallow: /\n");
  assert.equal(
    production.headers.get("content-type"),
    "text/plain; charset=utf-8",
  );
});

test("the sitemap lists fixed pages and the slugs the API returns, escaped, with no private page", async () => {
  const { api, paths } = apiReturning({
    events: [{ slug: "open-night", updated_at: "2031-05-01T12:00:00.5Z" }],
    schools: [{ slug: "a&b-college", updated_at: "2031-05-02T12:00:00Z" }],
    teams: [{ slug: "night owls", updated_at: "2031-05-03T12:00:00Z" }],
  });

  const response = await sitemapXmlResponse({ api, publicOrigin });
  const body = await response.text();

  assert.deepEqual(paths, ["/sitemap"]);
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("content-type"),
    "application/xml; charset=utf-8",
  );
  assert.equal(
    body,
    `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://cgn.example</loc></url>
  <url><loc>https://cgn.example/events</loc></url>
  <url><loc>https://cgn.example/schools</loc></url>
  <url><loc>https://cgn.example/teams</loc></url>
  <url><loc>https://cgn.example/about</loc></url>
  <url><loc>https://cgn.example/faq</loc></url>
  <url><loc>https://cgn.example/terms</loc></url>
  <url><loc>https://cgn.example/privacy</loc></url>
  <url><loc>https://cgn.example/events/open-night</loc><lastmod>2031-05-01T12:00:00.5Z</lastmod></url>
  <url><loc>https://cgn.example/schools/a%26b-college</loc><lastmod>2031-05-02T12:00:00Z</lastmod></url>
  <url><loc>https://cgn.example/teams/night%20owls</loc><lastmod>2031-05-03T12:00:00Z</lastmod></url>
</urlset>
`,
  );
  for (const path of [
    "/login",
    "/signup",
    "/account",
    "/settings",
    "/users/",
  ]) {
    assert.equal(body.includes(`${publicOrigin}${path}`), false, path);
  }
});

test("the sitemap answers 503, not a partial file, when the API is unavailable", async () => {
  const reported: unknown[] = [];
  const api: ApiClient = async () => {
    throw new Error("upstream down");
  };

  const response = await sitemapXmlResponse({
    api,
    publicOrigin,
    reportError: (error) => reported.push(error),
  });

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(reported.length, 1);
});

test("the sitemap rejects an API response that carries more than slugs and times", async () => {
  const { api } = apiReturning({
    events: [
      {
        slug: "open-night",
        updated_at: "2031-05-01T12:00:00Z",
        title: "Should not be here",
      },
    ],
    schools: [],
    teams: [],
  });

  const body = await (await sitemapXmlResponse({ api, publicOrigin })).text();

  assert.equal(body.includes("Should not be here"), false);
});
