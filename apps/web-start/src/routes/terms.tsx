import { createFileRoute } from "@tanstack/react-router";
import { publicPageHead } from "../components/public-page-head";

const description = "The terms of service for using Campus Gaming Network.";

export const Route = createFileRoute("/terms")({
  loader: ({ context }) => context.publicOrigin,
  head: ({ loaderData }) =>
    publicPageHead(loaderData, { title: "Terms", description, path: "/terms" }),
  component: TermsPage
});

function TermsPage() {
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
