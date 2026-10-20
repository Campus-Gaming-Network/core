import { Link, createFileRoute } from "@tanstack/react-router";
import { Callout } from "../components/callout";
import { newIdempotencyKey } from "../components/idempotency-key";
import { publicPageHead } from "../components/public-page-head";
import {
  supportTopicSubjects,
  validateSupportSearch,
} from "../features/support-slice/contracts";
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
    <main className="prose">
      <section className="page-heading">
        <div>
          <h1>Get support</h1>
          <p className="lede">
            Stuck on something, or found a problem? Tell us what happened and we
            will help.
          </p>
        </div>
      </section>
      {search.topic === "privacy" ? (
        <Callout icon="shield">
          <strong>Privacy request.</strong> Tell us what you want corrected or
          what you want to know about your data. Use the email address on your
          account so we can match the request to it. You can download your own
          data from <Link to="/settings/data">Your data</Link>.
        </Callout>
      ) : search.topic === "club" ? (
        <Callout>
          <strong>A club you run.</strong> To claim a listed club, use Claim
          this club on its page; to add one, use Request a club on your
          school&apos;s page. Write here when a claim was not approved or
          someone else manages your club&apos;s page. Tell us the club&apos;s
          name and school, and link to its page on your school&apos;s website or
          give an officer contact we can check; a school email address alone
          does not show that you run a club.
        </Callout>
      ) : null}
      <SupportTicketForm
        idempotencyKey={idempotencyKey}
        initialStatus={search.support}
        initialSubject={
          search.topic ? supportTopicSubjects[search.topic] : undefined
        }
      />
    </main>
  );
}
