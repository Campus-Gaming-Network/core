import { pageMetadata } from "../../lib/metadata";

export const metadata = pageMetadata({
  title: "About",
  description:
    "How Campus Gaming Network connects collegiate gamers with events, teams, and campus activity.",
  path: "/about"
});

export default function AboutPage() {
  return (
    <main className="narrow">
      <section className="page-heading">
        <p className="eyebrow">About</p>
        <h1>Campus Gaming Network connects collegiate gaming communities.</h1>
        <p className="lede">
          This first version focuses on school discovery, account basics, and
          the foundation for events and teams.
        </p>
      </section>
      <p>
        More detailed company and community information will land as the product
        moves beyond the Phase 1 MVP.
      </p>
    </main>
  );
}
