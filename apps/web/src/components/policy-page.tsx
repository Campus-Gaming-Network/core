import type { PolicyDocument } from "../policies";
import {
  anchoredSections,
  minimumSectionsForContents,
} from "./policy-sections";
import { PolicyContents } from "./policy-contents";
import { PageIntro } from "./page-heading";

const effectiveDate = new Intl.DateTimeFormat("en", {
  dateStyle: "long",
  timeZone: "UTC",
});

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
      <PageIntro title={document.heading} lede={<>{document.lede}</>}>
        <p className="policy-meta">
          <span>Version {document.version}</span>
          <span>Effective {effective}</span>
        </p>
      </PageIntro>
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
