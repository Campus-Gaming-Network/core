import { Accordion } from "@heroui/react/accordion";
import { pageMetadata } from "../../lib/metadata";

export const metadata = pageMetadata({
  title: "FAQ",
  description:
    "Answers to common questions about accounts, events, teams, and schools on Campus Gaming Network.",
  path: "/faq"
});

const faqs = [
  {
    question: "Can any school be listed?",
    answer:
      "Phase 1 starts with the seeded school list. Main and branch campuses are shown the same way."
  },
  {
    question: "Do I need to verify my email?",
    answer:
      "Yes. Verification is required before normal authenticated use."
  },
  {
    question: "Can I create events yet?",
    answer:
      "Yes. Logged-in users can create, edit, delete, and RSVP to event listings. Private events support password unlocks, and yes RSVPs send confirmation emails with calendar files."
  }
];

export default function FAQPage() {
  return (
    <main className="narrow">
      <section className="page-heading">
        <p className="eyebrow">FAQ</p>
        <h1>Frequently asked questions.</h1>
      </section>
      <Accordion>
        {faqs.map((item) => (
          <Accordion.Item key={item.question}>
            <Accordion.Heading>
              <Accordion.Trigger>{item.question}</Accordion.Trigger>
            </Accordion.Heading>
            <Accordion.Panel>
              <Accordion.Body>
                <p>{item.answer}</p>
              </Accordion.Body>
            </Accordion.Panel>
          </Accordion.Item>
        ))}
      </Accordion>
    </main>
  );
}
