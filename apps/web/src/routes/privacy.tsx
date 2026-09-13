import { createFileRoute } from "@tanstack/react-router";
import { publicPageHead } from "../components/public-page-head";

const description =
  "How Campus Gaming Network collects, uses, and protects your information.";

export const Route = createFileRoute("/privacy")({
  loader: ({ context }) => context.publicOrigin,
  head: ({ loaderData }) =>
    publicPageHead(loaderData, {
      title: "Privacy",
      description,
      path: "/privacy"
    }),
  component: PrivacyPage
});

function PrivacyPage() {
  return (
    <main className="narrow">
      <section className="page-heading">
        <p className="eyebrow">Privacy</p>
        <h1>Privacy placeholder</h1>
        <p className="lede">
          Campus Gaming Network stores account, profile, school, and session
          information. A reviewed privacy policy is still required before public
          launch.
        </p>
      </section>
      <p>
        This stub exists so the route is present during Phase 1 UI work without
        pretending legal copy has been finalized.
      </p>
    </main>
  );
}
