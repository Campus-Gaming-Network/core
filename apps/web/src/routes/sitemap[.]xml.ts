import { createFileRoute } from "@tanstack/react-router";
import { sitemapXmlResponse } from "../features/seo-slice/seo.server";
import { validatedPublicOrigin } from "../server/environment.server";
import { methodNotAllowedResponse } from "../server/health.server";
import { goBFFForHeaders } from "../server/request-boundary.server";

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: ({ request }) => handleSitemapRequest(request),
      HEAD: ({ request }) => handleSitemapRequest(request),
      POST: methodNotAllowedResponse,
      PUT: methodNotAllowedResponse,
      PATCH: methodNotAllowedResponse,
      DELETE: methodNotAllowedResponse,
      OPTIONS: methodNotAllowedResponse,
    },
  },
});

function handleSitemapRequest(request: Request): Promise<Response> {
  return sitemapXmlResponse({
    api: goBFFForHeaders(request.headers),
    publicOrigin: validatedPublicOrigin(),
  });
}
