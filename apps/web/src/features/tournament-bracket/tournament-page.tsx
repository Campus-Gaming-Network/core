import { notFound } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { BreadcrumbLink, Breadcrumbs } from "../../components/breadcrumbs";
import { PageNoticeView } from "../../components/page-notice-view";
import { pageHead } from "../../components/public-page-head";
import type { EventDTO } from "../event-slice/contracts";
import { getEventDetail } from "../event-slice/event.functions";
import eventCSS from "../event-slice/events.css?url";
import type { TournamentDTO } from "../tournament-registration/contracts";
import { TournamentTabs, ViewerMatchCard } from "./bracket-views";
import { getTournamentMatches } from "./bracket.functions";
import {
  bracketNotices,
  type BracketNotice,
  type BracketResult,
} from "./contracts";
import type { TournamentSection } from "./presentation";
import { viewerMatch, type ViewerMatch } from "./viewer-match";

export type TournamentPageData = {
  event: EventDTO & { tournament: TournamentDTO };
  bracket: BracketResult;
  publicOrigin: string;
};

/**
 * Loads a tournament section page. The bracket read runs first and the
 * detail read last, as on the event page, because of the detail's cache
 * policy. An event without a tournament, or one the viewer has not
 * unlocked, has no such page.
 */
export async function loadTournamentPage(
  slug: string,
  publicOrigin: string,
): Promise<TournamentPageData> {
  const bracket = await getTournamentMatches({ data: { slug } });
  const detail = await getEventDetail({ data: { slug } });
  if (detail.status === "not_found") throw notFound();
  if (detail.status !== "found") {
    throw new Error("Event detail is unavailable");
  }
  if ("locked" in detail.event) throw notFound();
  const { tournament } = detail.event;
  if (!tournament) throw notFound();
  return { event: { ...detail.event, tournament }, bracket, publicOrigin };
}

export function hasBracket(bracket: BracketResult | undefined): boolean {
  return bracket?.status === "ready" && bracket.matches.length > 0;
}

/** Whether any match has a time, which shows the Schedule tab. */
export function hasSchedule(bracket: BracketResult | undefined): boolean {
  return (
    bracket?.status === "ready" &&
    bracket.matches.some((match) => match.scheduled_at !== undefined)
  );
}

/**
 * The viewer's place in the bracket when they have a registered entry in it.
 * A pending request has no seed, so it never has a match.
 */
export function viewerBracketMatch(
  tournament: TournamentDTO,
  bracket: BracketResult | undefined,
): ViewerMatch | undefined {
  const entry = tournament.viewer_entry;
  if (!entry || entry.status !== "registered" || bracket?.status !== "ready") {
    return undefined;
  }
  return viewerMatch(bracket.matches, entry.id);
}

/** A section page's head: never indexed, like the event's other subpages. */
export function tournamentPageHead(
  loaderData: TournamentPageData | undefined,
  { title, path }: { title: string; path: string },
) {
  const head = pageHead(loaderData?.publicOrigin, {
    title: loaderData ? `${title} · ${loaderData.event.title}` : title,
    description: "A tournament on Campus Gaming Network.",
    path: loaderData
      ? `/events/${encodeURIComponent(loaderData.event.slug)}/${path}`
      : "/events",
    noIndex: true,
  });
  return {
    ...head,
    links: [...head.links, { rel: "stylesheet", href: eventCSS }],
  };
}

export function TournamentPage({
  children,
  current,
  currentMatchID,
  data,
  heading,
  notice,
}: {
  children: ReactNode;
  current: TournamentSection;
  /** The match a match page shows, whose own page needs no card for it. */
  currentMatchID?: string;
  data: TournamentPageData;
  heading: string;
  notice?: BracketNotice;
}) {
  const { event } = data;
  const own = viewerBracketMatch(event.tournament, data.bracket);
  return (
    <main className="tournament-page">
      <Breadcrumbs current={heading}>
        <BreadcrumbLink to="/events">Events</BreadcrumbLink>
        <BreadcrumbLink params={{ slug: event.slug }} to="/events/$slug">
          {event.title}
        </BreadcrumbLink>
      </Breadcrumbs>
      <h1>{event.title}</h1>
      <TournamentTabs
        current={current}
        hasBracket={hasBracket(data.bracket)}
        hasSchedule={hasSchedule(data.bracket)}
        slug={event.slug}
        tournament={event.tournament}
      />
      <PageNoticeView notice={notice ? bracketNotices[notice] : undefined} />
      {own && !(own.kind !== "won" && own.match.id === currentMatchID) ? (
        <ViewerMatchCard
          result={own}
          slug={event.slug}
          team={event.tournament.entry_type === "team"}
          timeZone={event.timezone}
        />
      ) : null}
      {children}
    </main>
  );
}
