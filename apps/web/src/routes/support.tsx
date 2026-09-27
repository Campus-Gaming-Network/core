import { createFileRoute } from "@tanstack/react-router";
import { newIdempotencyKey } from "../components/idempotency-key";
import { publicPageHead } from "../components/public-page-head";
import { validateSupportSearch } from "../features/support-slice/contracts";
import { SupportTicketForm } from "../features/support-slice/support-ticket-form";

const description =
  "Get help with Campus Gaming Network or send the team a support request.";

export const Route = createFileRoute("/support")({
  validateSearch: validateSupportSearch,
  loader: ({ context }) => ({
    publicOrigin: context.publicOrigin,
    idempotencyKey: newIdempotencyKey(),
  }),
  // The form's idempotency key is per visitor, so shared caches must not
  // reuse this page.
  headers: () => ({ "cache-control": "private, no-store", vary: "Cookie" }),
  head: ({ loaderData }) =>
    publicPageHead(loaderData?.publicOrigin, {
      title: "Support",
      description,
      path: "/support",
    }),
  component: SupportPage,
});

function SupportPage() {
  const search = Route.useSearch();
  const { idempotencyKey } = Route.useLoaderData();

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
      <SupportTicketForm
        idempotencyKey={idempotencyKey}
        initialStatus={search.support}
      />
    </main>
  );
}
