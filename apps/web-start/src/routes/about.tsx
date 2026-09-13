import { createFileRoute } from "@tanstack/react-router";
import { publicPageHead } from "../components/public-page-head";

const description =
  "How Campus Gaming Network connects collegiate gamers with events, teams, and campus activity.";

export const Route = createFileRoute("/about")({
  loader: ({ context }) => context.publicOrigin,
  head: ({ loaderData }) =>
    publicPageHead(loaderData, { title: "About", description, path: "/about" }),
  component: AboutPage
});

function AboutPage() {
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
        grows.
      </p>
    </main>
  );
}
