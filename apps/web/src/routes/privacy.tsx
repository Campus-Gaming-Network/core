import { createFileRoute, notFound } from "@tanstack/react-router";
import { PolicyPage } from "../components/policy-page";
import { publicPageHead } from "../components/public-page-head";
import { policyDocument, validatePolicySearch } from "../policies";

const description =
  "How Campus Gaming Network collects, uses, and protects your information.";

export const Route = createFileRoute("/privacy")({
  validateSearch: validatePolicySearch,
  loaderDeps: ({ search }) => ({ version: search.version }),
  loader: ({ context, deps }) => {
    // A link from the signup form names the exact version a person accepts.
    if (!policyDocument("privacy", deps.version)) throw notFound();
    return { publicOrigin: context.publicOrigin };
  },
  head: ({ loaderData }) =>
    publicPageHead(loaderData?.publicOrigin, {
      title: "Privacy",
      description,
      path: "/privacy",
    }),
  component: PrivacyPage,
});

function PrivacyPage() {
  const document = policyDocument("privacy", Route.useSearch().version);
  return document ? <PolicyPage document={document} eyebrow="Privacy" /> : null;
}
