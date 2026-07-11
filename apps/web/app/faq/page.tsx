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
      "Yes. Logged-in users can create, edit, and delete MVP event listings, and private events support password unlocks. RSVP and email confirmations are coming next."
  }
];

export default function FAQPage() {
  return (
    <main className="narrow">
      <section className="page-heading">
        <p className="eyebrow">FAQ</p>
        <h1>Questions for the MVP.</h1>
      </section>
      <div className="list">
        {faqs.map((item) => (
          <article className="list-item block" key={item.question}>
            <h2>{item.question}</h2>
            <p>{item.answer}</p>
          </article>
        ))}
      </div>
    </main>
  );
}
