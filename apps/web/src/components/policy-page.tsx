import type { PolicyDocument } from "../policies";
import {
  anchoredSections,
  minimumSectionsForContents,
} from "./policy-sections";
import { PolicyContents } from "./policy-contents";

const effectiveDate = new Intl.DateTimeFormat("en", {
  dateStyle: "long",
  timeZone: "UTC",
});

/** One published version of a policy, with the version a person can cite. */
export function PolicyPage({ document }: { document: PolicyDocument }) {
  const sections = anchoredSections(document.sections ?? []);
  const hasContents = sections.length >= minimumSectionsForContents;
  const effective = (
    <time dateTime={document.effectiveAt}>
      {effectiveDate.format(new Date(document.effectiveAt))}
    </time>
  );
  return (
    <main className="prose policy-page" id="policy-top">
      <section className="page-heading">
        <div>
          <h1>{document.heading}</h1>
          <p className="lede">{document.lede}</p>
          <p className="policy-meta">
            <span>Version {document.version}</span>
            <span>Effective {effective}</span>
          </p>
        </div>
      </section>
      <div className={hasContents ? "policy-layout has-contents" : undefined}>
        {hasContents ? <PolicyContents sections={sections} /> : null}
        <div className="policy-body">
          {document.paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
          {sections.map((section) => (
            <section
              aria-labelledby={section.id}
              className="policy-section"
              key={section.id}
            >
              <h2 id={section.id}>{section.heading}</h2>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
              {hasContents ? (
                <a className="back-to-top" href="#policy-top">
                  Back to top
                </a>
              ) : null}
            </section>
          ))}
          <p className="policy-version">
            Version {document.version}, effective {effective}.
          </p>
        </div>
      </div>
    </main>
  );
}
