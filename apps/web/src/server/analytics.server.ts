/**
 * Plausible analytics, served through this origin. The page loads
 * `/insights/script.js` and posts events to `/insights/event`; this module
 * fetches Plausible's script and forwards each event after cleaning it, so the
 * browser never contacts Plausible and the content security policy keeps
 * allowing only this origin. Analytics are on only when PLAUSIBLE_DOMAIN names
 * the Plausible site.
 */

import { plausibleDomain, plausibleDomainIssue } from "./environment.server.js";

export { plausibleDomain };

const plausibleOrigin = "https://plausible.io";

/** The script is kept this long before it is fetched again. */
const scriptCacheMilliseconds = 6 * 60 * 60 * 1000;

/** The largest event body forwarded; Plausible's are a few hundred bytes. */
const maximumEventBytes = 4096;

type Environment = Readonly<Record<string, string | undefined>>;

type AnalyticsDependencies = {
  environment?: Environment;
  fetcher?: typeof fetch;
  now?: () => number;
};

let cachedScript: { body: string; fetchedAt: number } | undefined;

/** Plausible's script, from a copy kept a few hours. */
export async function analyticsScriptResponse({
  environment = process.env,
  fetcher = fetch,
  now = Date.now,
}: AnalyticsDependencies = {}): Promise<Response> {
  if (!plausibleDomain(environment) || plausibleDomainIssue(environment)) {
    return new Response(null, { status: 404 });
  }
  if (
    !cachedScript ||
    now() - cachedScript.fetchedAt > scriptCacheMilliseconds
  ) {
    try {
      const upstream = await fetcher(`${plausibleOrigin}/js/script.js`);
      if (!upstream.ok) throw new Error(`Plausible script ${upstream.status}`);
      cachedScript = { body: await upstream.text(), fetchedAt: now() };
    } catch {
      // A stale copy beats none; with none, the page simply goes uncounted.
      if (!cachedScript) return new Response(null, { status: 502 });
    }
  }
  return new Response(cachedScript.body, {
    headers: {
      "cache-control": "public, max-age=86400",
      "content-type": "application/javascript; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}

/** Forgets the cached script; for tests. */
export function resetAnalyticsScriptCache(): void {
  cachedScript = undefined;
}

type PlausibleEvent = {
  n: string;
  u: string;
  d: string;
  r: string | null;
  [key: string]: unknown;
};

/**
 * Forwards one event to Plausible. The event must come from this site's own
 * pages. It always names the configured site, and its page and referrer
 * addresses lose their query strings, except for utm_ campaign tags, so a
 * token in a link (a password reset, an invite) never leaves this server.
 */
export async function analyticsEventResponse(
  request: Request,
  {
    environment = process.env,
    fetcher = fetch,
    siteOrigin,
  }: AnalyticsDependencies & { siteOrigin: string },
): Promise<Response> {
  const domain = plausibleDomain(environment);
  if (!domain || plausibleDomainIssue(environment)) {
    return new Response(null, { status: 404 });
  }
  if (request.headers.get("origin") !== siteOrigin) {
    return new Response(null, { status: 403 });
  }
  const text = await request.text();
  if (text.length > maximumEventBytes) {
    return new Response(null, { status: 413 });
  }
  const event = cleanEvent(text, siteOrigin, domain);
  if (!event) return new Response(null, { status: 400 });

  try {
    const upstream = await fetcher(`${plausibleOrigin}/api/event`, {
      method: "POST",
      headers: visitorHeaders(request.headers),
      body: JSON.stringify(event),
    });
    return new Response(null, { status: upstream.ok ? 202 : 502 });
  } catch {
    return new Response(null, { status: 502 });
  }
}

/**
 * Goals sent from the server when a form succeeds, so they count native form
 * posts without JavaScript. Each must also be created as a goal in Plausible.
 */
export type AnalyticsGoal =
  | { name: "Signup" }
  | { name: "Join club" }
  | { name: "RSVP"; response: "yes" | "maybe" | "no" };

/** Sends a goal once a form succeeds; operations default to sending none. */
export type GoalSender = (goal: AnalyticsGoal) => void;

/**
 * Sends one goal for the visitor who made `request`. It names the page the
 * form was on, from the Referer header without its query string, and the
 * visitor's address and agent, so Plausible joins it to that visit. It never
 * throws: a goal that cannot be sent is not worth failing the form over.
 */
export async function sendAnalyticsGoal(
  goal: AnalyticsGoal,
  request: { headers: Headers },
  {
    environment = process.env,
    fetcher = fetch,
    siteOrigin,
  }: AnalyticsDependencies & { siteOrigin: string },
): Promise<void> {
  const domain = plausibleDomain(environment);
  if (!domain || plausibleDomainIssue(environment)) return;
  const referer = withoutQuery(request.headers.get("referer") ?? "");
  const page =
    referer && new URL(referer).origin === siteOrigin
      ? referer
      : `${siteOrigin}/`;
  const { name, ...props } = goal;
  const event: PlausibleEvent = { n: name, u: page, d: domain, r: null };
  if (Object.keys(props).length) event.p = props;
  try {
    await fetcher(`${plausibleOrigin}/api/event`, {
      method: "POST",
      headers: visitorHeaders(request.headers),
      body: JSON.stringify(event),
    });
  } catch {
    // Dropped, like a page view the browser could not send.
  }
}

function visitorHeaders(incoming: Headers): Headers {
  const headers = new Headers({ "content-type": "application/json" });
  const userAgent = incoming.get("user-agent");
  if (userAgent) headers.set("user-agent", userAgent);
  // Plausible counts unique visitors from the address and user agent, and
  // stores neither. Cloudflare names the visitor's address in its own header.
  const clientAddress =
    incoming.get("cf-connecting-ip") ??
    incoming.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (clientAddress) headers.set("x-forwarded-for", clientAddress);
  return headers;
}

/** The event to forward, or undefined when the body is not one of ours. */
export function cleanEvent(
  text: string,
  siteOrigin: string,
  domain: string,
): PlausibleEvent | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }
  const event = parsed as Record<string, unknown>;
  if (
    typeof event.n !== "string" ||
    event.n.length === 0 ||
    event.n.length > 120
  ) {
    return undefined;
  }
  if (typeof event.u !== "string") return undefined;
  const page = withoutQuery(event.u);
  if (!page || new URL(page).origin !== siteOrigin) return undefined;
  const referrer =
    typeof event.r === "string" && event.r !== ""
      ? (withoutQuery(event.r) ?? null)
      : null;
  return { ...event, n: event.n, u: page, d: domain, r: referrer };
}

function withoutQuery(address: string): string | undefined {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  const campaign = new URLSearchParams();
  for (const [name, value] of url.searchParams) {
    if (name.startsWith("utm_")) campaign.append(name, value);
  }
  const query = campaign.toString();
  return `${url.origin}${url.pathname}${query ? `?${query}` : ""}`;
}
