import * as z from "zod";
import type { ApiClient } from "../../server/api.server.js";
import type { DeploymentEnvironment } from "../../server/environment.server.js";

const sitemapEntrySchema = z.object({
  slug: z.string().trim().min(1).max(200),
  updated_at: z.iso.datetime({ offset: true }),
});

/** What `GET /sitemap` on the API returns: slugs and change times only. */
export const sitemapDtoSchema = z.object({
  events: z.array(sitemapEntrySchema),
  schools: z.array(sitemapEntrySchema),
  teams: z.array(sitemapEntrySchema),
});

export type SitemapDTO = z.output<typeof sitemapDtoSchema>;

/**
 * Pages every visitor may index. Login, signup, account, settings, and people
 * pages are left out because they are noindex, and so are profiles.
 */
const fixedPaths = [
  "",
  "/events",
  "/schools",
  "/teams",
  "/about",
  "/faq",
  "/terms",
  "/privacy",
] as const;

const responseHeaders = {
  "cache-control": "public, max-age=300, stale-while-revalidate=86400",
  "x-content-type-options": "nosniff",
} as const;

type Dependencies = {
  api: ApiClient;
  deploymentEnvironment: DeploymentEnvironment;
  publicOrigin: string;
  reportError?: (error: unknown) => void;
};

/**
 * robots.txt. Only production is open to crawlers; staging and local builds
 * ask them to stay out. Pages that must stay out of search carry noindex
 * instead of a Disallow rule, because a crawler that is not allowed to fetch a
 * page never sees its noindex tag. The API routes are not pages.
 */
export function robotsTxtResponse({
  deploymentEnvironment,
  publicOrigin,
}: Pick<Dependencies, "deploymentEnvironment" | "publicOrigin">): Response {
  const body =
    deploymentEnvironment === "production"
      ? `User-agent: *\nDisallow: /api/\n\nSitemap: ${publicOrigin}/sitemap.xml\n`
      : "User-agent: *\nDisallow: /\n";

  return new Response(body, {
    headers: {
      ...responseHeaders,
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

/**
 * sitemap.xml: the fixed pages plus every public event, school, and team. It is
 * served in every environment; robots.txt decides whether crawlers use it.
 */
export async function sitemapXmlResponse({
  api,
  publicOrigin,
  reportError = defaultErrorReporter,
}: Omit<Dependencies, "deploymentEnvironment">): Promise<Response> {
  let sitemap: SitemapDTO;
  try {
    ({ data: sitemap } = await api({
      path: "/sitemap",
      responseSchema: sitemapDtoSchema,
    }));
  } catch (error) {
    reportError(error);
    return new Response(null, {
      status: 503,
      headers: { "cache-control": "no-store", "retry-after": "300" },
    });
  }

  return new Response(sitemapXml(sitemap, publicOrigin), {
    headers: {
      ...responseHeaders,
      "content-type": "application/xml; charset=utf-8",
    },
  });
}

export function sitemapXml(sitemap: SitemapDTO, publicOrigin: string): string {
  const urls = [
    ...fixedPaths.map((path) => ({ path, updatedAt: undefined })),
    ...sitemap.events.map((entry) => ({
      path: `/events/${encodeURIComponent(entry.slug)}`,
      updatedAt: entry.updated_at,
    })),
    ...sitemap.schools.map((entry) => ({
      path: `/schools/${encodeURIComponent(entry.slug)}`,
      updatedAt: entry.updated_at,
    })),
    ...sitemap.teams.map((entry) => ({
      path: `/teams/${encodeURIComponent(entry.slug)}`,
      updatedAt: entry.updated_at,
    })),
  ];

  const entries = urls.map(
    ({ path, updatedAt }) =>
      `  <url><loc>${escapeXml(`${publicOrigin}${path}`)}</loc>${
        updatedAt ? `<lastmod>${updatedAt}</lastmod>` : ""
      }</url>`,
  );

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</urlset>\n`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function defaultErrorReporter(error: unknown): void {
  console.error("sitemap unavailable", error);
}
