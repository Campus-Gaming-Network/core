import { notFound } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { BreadcrumbLink, Breadcrumbs } from "../../components/breadcrumbs";
import { PageNoticeView } from "../../components/page-notice-view";
import { pageHead } from "../../components/public-page-head";
import type { EventDTO } from "../event-slice/contracts";
import { getEventDetail } from "../event-slice/event.functions";
import eventCSS from "../event-slice/events.css?url";
import type { TournamentDTO } from "../tournament-registration/contracts";
import { TournamentTabs } from "./bracket-views";
import { getTournamentMatches } from "./bracket.functions";
import {
  bracketNotices,
  type BracketNotice,
  type BracketResult,
} from "./contracts";
import type { TournamentSection } from "./presentation";

/** What every tournament section page loads: the event and its bracket. */
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

/** Whether a bracket has been generated, which shows the Bracket tab. */
export function hasBracket(bracket: BracketResult | undefined): boolean {
  return bracket?.status === "ready" && bracket.matches.length > 0;
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

/** A section page: breadcrumbs, the event's title, the tabs, and a notice. */
export function TournamentPage({
  children,
  current,
  data,
  heading,
  notice,
}: {
  children: ReactNode;
  current: TournamentSection;
  data: TournamentPageData;
  heading: string;
  notice?: BracketNotice;
}) {
  const { event } = data;
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
        slug={event.slug}
        tournament={event.tournament}
      />
      <PageNoticeView notice={notice ? bracketNotices[notice] : undefined} />
      {children}
    </main>
  );
}
