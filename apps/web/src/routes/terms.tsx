import { createFileRoute, notFound } from "@tanstack/react-router";
import { PolicyPage } from "../components/policy-page";
import { publicPageHead } from "../components/public-page-head";
import { policyDocument, validatePolicySearch } from "../policies";

const description = "The terms of service for using Campus Gaming Network.";

export const Route = createFileRoute("/terms")({
  validateSearch: validatePolicySearch,
  loaderDeps: ({ search }) => ({ version: search.version }),
  loader: ({ context, deps }) => {
    // A link from the signup form names the exact version a person accepts.
    if (!policyDocument("terms", deps.version)) throw notFound();
    return { publicOrigin: context.publicOrigin };
  },
  head: ({ loaderData }) =>
    publicPageHead(loaderData?.publicOrigin, {
      title: "Terms",
      description,
      path: "/terms",
    }),
  component: TermsPage,
});

function TermsPage() {
  const document = policyDocument("terms", Route.useSearch().version);
  return document ? <PolicyPage document={document} eyebrow="Terms" /> : null;
}
