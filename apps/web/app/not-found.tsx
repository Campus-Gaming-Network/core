import Link from "next/link";
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
        <p className="eyebrow">404</p>
        <h1>We could not find that page.</h1>
        <p className="lede">
          The link may be broken, or the event, team, or school may have been
          removed.
        </p>
        <div className="actions">
          <Link className="button button--primary" href="/">
            Go home
          </Link>
          <Link className="button button--secondary" href="/events">
            Browse events
          </Link>
          <Link className="button button--secondary" href="/schools">
            Browse schools
          </Link>
          <Link className="button button--secondary" href="/teams">
            Browse teams
          </Link>
        </div>
      </section>
    </main>
  );
}
