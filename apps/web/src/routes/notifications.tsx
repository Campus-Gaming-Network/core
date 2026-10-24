import { Link, createFileRoute, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import type { FormEvent } from "react";
import {
  FormErrorSummary,
  useEnhancedMutation,
} from "../components/enhanced-mutation";
import { PageNoticeView } from "../components/page-notice-view";
import { pageHead } from "../components/public-page-head";
import { RouteErrorView, RoutePending } from "../components/route-boundaries";
import {
  inboxNotices,
  validateInboxSearch,
  type InboxEntry,
} from "../features/notifications/contracts";
import {
  getInbox,
  markAllNotificationsRead,
  markNotificationRead,
} from "../features/notifications/notifications.functions";
import inboxCSS from "../features/notifications/notifications.css?url";
import { PageIntro } from "../components/page-heading";
import { Button } from "../components/button";
import { Surface } from "../components/surface";

export const Route = createFileRoute("/notifications")({
  validateSearch: validateInboxSearch,
  loaderDeps: ({ search }) => ({ after: search.after }),
  loader: async ({ context, deps }) => {
    const inbox = await getInbox({ data: { after: deps.after } });
    if (inbox.status === "unauthenticated") {
      throw redirect({ to: "/login", search: { next: "/notifications" } });
    }
    return { inbox, publicOrigin: context.publicOrigin };
  },
  staleTime: 0,
  headers: () => ({ "cache-control": "private, no-store", vary: "Cookie" }),
  head: ({ loaderData }) => {
    const head = pageHead(loaderData?.publicOrigin, {
      title: "Notifications",
      description: "Your Campus Gaming Network notifications.",
      path: "/notifications",
      noIndex: true,
    });
    return {
      ...head,
      links: [...head.links, { rel: "stylesheet", href: inboxCSS }],
    };
  },
  pendingComponent: InboxPending,
  errorComponent: InboxError,
  component: InboxPage,
});

/**
 * The signed-in person's notifications, newest first. Opening one about an
 * event marks it read and goes to the event. Every control is a native form,
 * so the page works without JavaScript.
 */
function InboxPage() {
  const { inbox } = Route.useLoaderData();
  const search = Route.useSearch();
  const runMarkAll = useServerFn(markAllNotificationsRead);
  const mutation = useEnhancedMutation(
    "We could not update your notifications. Please try again.",
  );
  const entries = inbox.status === "ready" ? inbox.entries : [];
  const anyUnread = entries.some((entry) => !entry.read_at);

  return (
    <main className="inbox-page">
      <PageIntro
        title="Notifications"
        lede="Updates about events you are going to, events you organize, and your teams."
        actions={
          anyUnread ? (
            <form
              action={markAllNotificationsRead.url}
              method="post"
              onSubmit={async (event) => {
                event.preventDefault();
                await mutation.execute(() => runMarkAll());
              }}
            >
              <Button
                variant="secondary"
                disabled={mutation.pending}
                type="submit"
              >
                Mark all as read
              </Button>
            </form>
          ) : null
        }
      />
      <PageNoticeView
        notice={search.notice ? inboxNotices[search.notice] : undefined}
      />
      <FormErrorSummary
        fieldErrors={mutation.fieldErrors}
        message={mutation.message}
        summaryRef={mutation.errorSummaryRef}
      />
      {inbox.status === "unavailable" ? (
        <p role="alert">
          Your notifications are unavailable right now. Try again later.
        </p>
      ) : entries.length === 0 ? (
        <Surface variant="empty">
          <h2>
            {search.after ? "No older notifications" : "No notifications yet"}
          </h2>
          <p>
            When an event you are going to is cancelled, someone joins an event
            you organize or a team you own, or a team is handed to you, it shows
            up here.
          </p>
        </Surface>
      ) : (
        <ol className="inbox-list">
          {entries.map((entry) => (
            <InboxItem
              entry={entry}
              key={entry.id}
              pending={mutation.pending}
              run={mutation.execute}
            />
          ))}
        </ol>
      )}
      {inbox.status === "ready" && (search.after || inbox.nextCursor) ? (
        <nav aria-label="Notification pages" className="pagination">
          {search.after ? <Link to="/notifications">Newest</Link> : <span />}
          {inbox.nextCursor ? (
            <Link search={{ after: inbox.nextCursor }} to="/notifications">
              Older
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </main>
  );
}

function InboxItem({
  entry,
  pending,
  run,
}: {
  entry: InboxEntry;
  pending: boolean;
  run: ReturnType<typeof useEnhancedMutation>["execute"];
}) {
  const runMarkRead = useServerFn(markNotificationRead);
  const unread = !entry.read_at;
  const opens = entry.event_slug
    ? "View event"
    : entry.team_slug
      ? "View team"
      : undefined;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await run(() => runMarkRead({ data }));
  }

  return (
    <li className={unread ? "inbox-item inbox-item--unread" : "inbox-item"}>
      <div className="inbox-item__copy">
        <p className="inbox-item__title">
          {unread ? <span className="inbox-item__new">New</span> : null}
          <strong>{entry.title}</strong>
        </p>
        <p>{entry.body}</p>
        <small>{entry.createdLabel}</small>
      </div>
      {opens || unread ? (
        <form action={markNotificationRead.url} method="post" onSubmit={submit}>
          <input name="notification_id" type="hidden" value={entry.id} />
          {entry.event_slug ? (
            <input name="event_slug" type="hidden" value={entry.event_slug} />
          ) : entry.team_slug ? (
            <input name="team_slug" type="hidden" value={entry.team_slug} />
          ) : null}
          <Button
            variant="secondary"
            size="small"
            disabled={pending}
            type="submit"
          >
            {opens ?? "Mark as read"}
            <span className="visually-hidden">: {entry.title}</span>
          </Button>
        </form>
      ) : null}
    </li>
  );
}

function InboxPending() {
  return <RoutePending message="Loading notifications…" />;
}

function InboxError() {
  return (
    <RouteErrorView
      eyebrow="Notifications unavailable"
      heading="We could not load your notifications."
      description="Please try again in a moment."
      showNavigation={false}
    />
  );
}
