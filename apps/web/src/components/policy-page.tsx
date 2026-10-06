import type { PolicyDocument } from "../policies";

const effectiveDate = new Intl.DateTimeFormat("en", {
  dateStyle: "long",
  timeZone: "UTC",
});

/** One published version of a policy, with the version a person can cite. */
export function PolicyPage({
  document,
  eyebrow,
}: {
  document: PolicyDocument;
  eyebrow: string;
}) {
  return (
    <main className="narrow">
      <section className="page-heading">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{document.heading}</h1>
        <p className="lede">{document.lede}</p>
      </section>
      {document.paragraphs.map((paragraph) => (
        <p key={paragraph}>{paragraph}</p>
      ))}
      <p className="policy-version">
        Version {document.version}, effective{" "}
        <time dateTime={document.effectiveAt}>
          {effectiveDate.format(new Date(document.effectiveAt))}
        </time>
        .
      </p>
    </main>
  );
}
