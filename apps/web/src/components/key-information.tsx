import { useId, type ReactNode } from "react";

/**
 * A card of facts for a detail page's side panel, written as a description
 * list: each term (Games, Members) beside its value. Leave a fact out rather
 * than pass an empty value.
 */
export function KeyInformation({
  facts,
  title = "Key information",
}: {
  facts: { term: string; value: ReactNode }[];
  title?: string;
}) {
  const headingID = useId();

  return (
    <section
      aria-labelledby={headingID}
      className="detail-card key-information"
    >
      <h2 id={headingID}>{title}</h2>
      <dl>
        {facts.map((fact) => (
          <div key={fact.term}>
            <dt>{fact.term}</dt>
            <dd>{fact.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
