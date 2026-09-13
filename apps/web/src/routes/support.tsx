import { createFileRoute } from "@tanstack/react-router";
import { publicPageHead } from "../components/public-page-head";
import {
  validateSupportSearch
} from "../features/support-slice/contracts";
import { SupportTicketForm } from "../features/support-slice/support-ticket-form";

const description =
  "Get help with Campus Gaming Network or send the team a support request.";

export const Route = createFileRoute("/support")({
  validateSearch: validateSupportSearch,
  loader: ({ context }) => context.publicOrigin,
  head: ({ loaderData }) =>
    publicPageHead(loaderData, {
      title: "Support",
      description,
      path: "/support"
    }),
  component: SupportPage
});

function SupportPage() {
  const search = Route.useSearch();

  return (
    <main className="narrow">
      <section className="page-heading">
        <p className="eyebrow">Support</p>
        <h1>Need help?</h1>
        <p className="lede">
          Send a support ticket and include enough detail for the team to
          investigate. Never send passwords or payment information.
        </p>
      </section>
      <SupportTicketForm initialStatus={search.support} />
    </main>
  );
}
