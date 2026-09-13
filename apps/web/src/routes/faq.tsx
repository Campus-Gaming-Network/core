import { createFileRoute } from "@tanstack/react-router";
import { publicPageHead } from "../components/public-page-head";

const description =
  "Answers to common questions about accounts, events, teams, and schools on Campus Gaming Network.";

const faqs = [
  {
    question: "Can any school be listed?",
    answer:
      "Phase 1 starts with the seeded school list. Main and branch campuses are shown the same way."
  },
  {
    question: "Do I need to verify my email?",
    answer: "Yes. Verification is required before normal authenticated use."
  },
  {
    question: "Can I create events yet?",
    answer:
      "Yes. Logged-in users can create, edit, delete, and RSVP to event listings. Private events support password unlocks, and yes RSVPs send confirmation emails with calendar files."
  }
];

export const Route = createFileRoute("/faq")({
  loader: ({ context }) => context.publicOrigin,
  head: ({ loaderData }) =>
    publicPageHead(loaderData, { title: "FAQ", description, path: "/faq" }),
  component: FAQPage
});

function FAQPage() {
  return (
    <main className="narrow">
      <section className="page-heading">
        <p className="eyebrow">FAQ</p>
        <h1>Frequently asked questions.</h1>
      </section>
      <section aria-label="Frequently asked questions">
        {faqs.map((item) => (
          <details key={item.question}>
            <summary>{item.question}</summary>
            <p>{item.answer}</p>
          </details>
        ))}
      </section>
    </main>
  );
}
