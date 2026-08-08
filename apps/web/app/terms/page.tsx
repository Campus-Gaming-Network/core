import { pageMetadata } from "../../lib/metadata";

export const metadata = pageMetadata({
  title: "Terms",
  description:
    "The terms of service for using Campus Gaming Network.",
  path: "/terms"
});

export default function TermsPage() {
  return (
    <main className="narrow">
      <section className="page-heading">
        <p className="eyebrow">Terms</p>
        <h1>Terms placeholder</h1>
        <p className="lede">
          Formal terms are not drafted in Phase 1. This page is a placeholder
          for review before public launch.
        </p>
      </section>
      <p>
        Do not treat this placeholder as legal policy. Replace it with reviewed
        terms before opening the product beyond local development or private
        testing.
      </p>
    </main>
  );
}
