import Link from "next/link";
import { Icon, appIcon } from "../components/icon";
import { pageMetadata } from "../lib/metadata";

export const metadata = pageMetadata({
  title: "Page not found",
  description: "That page does not exist on Campus Gaming Network.",
  noIndex: true
});

export default function NotFound() {
  return (
    <main className="narrow">
      <section className="page-heading">
        <span className="icon-badge">
          <Icon icon={appIcon.notFound} size="xl" />
        </span>
        <p className="eyebrow">404</p>
        <h1>We could not find that page.</h1>
        <p className="lede">
          The link may be broken, or the event, team, or school may have been
          removed.
        </p>
        <div className="actions">
          <Link className="button button--primary" href="/">
            <Icon icon={appIcon.home} />
            Go home
          </Link>
          <Link className="button button--secondary" href="/events">
            <Icon icon={appIcon.event} />
            Browse events
          </Link>
          <Link className="button button--secondary" href="/schools">
            <Icon icon={appIcon.school} />
            Browse schools
          </Link>
          <Link className="button button--secondary" href="/teams">
            <Icon icon={appIcon.team} />
            Browse teams
          </Link>
        </div>
      </section>
    </main>
  );
}
