import { useEffect, useState } from "react";

/**
 * Links to the sections of a long form on the same page, numbered in order
 * as on reference sheets 09 and 10. It is plain anchor navigation, not a
 * stepper: every section is on the page and the form submits once. It shows
 * as a sticky column from the desktop width and is hidden below it.
 *
 * With JavaScript the link for the section in view gets `aria-current`. The
 * value is "location", not "step": "step" means one step of a process, and
 * these are parts of one page that can be filled in any order. Without
 * JavaScript the stylesheet keeps the first link highlighted.
 */
export function FormSectionNav({
  heading,
  sections,
}: {
  heading: string;
  sections: readonly { id: string; label: string }[];
}) {
  const [current, setCurrent] = useState<string | null>(null);

  useEffect(() => {
    const elements = sections.flatMap((section) => {
      const element = document.getElementById(section.id);
      return element ? [element] : [];
    });
    if (elements.length === 0 || !("IntersectionObserver" in window)) return;

    setCurrent(elements[0].id);
    const inView = new Set<string>();
    // A band near the top of the viewport decides which section is "in view".
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) inView.add(entry.target.id);
          else inView.delete(entry.target.id);
        }
        const first = elements.find((element) => inView.has(element.id));
        if (first) setCurrent(first.id);
      },
      { rootMargin: "-15% 0px -65% 0px" },
    );
    for (const element of elements) observer.observe(element);
    // The last section is often too short to reach the band, so the bottom
    // of the page counts as being in it.
    const onScroll = () => {
      const atBottom =
        window.innerHeight + window.scrollY >=
        document.documentElement.scrollHeight - 2;
      if (atBottom) setCurrent(elements[elements.length - 1].id);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
  }, [sections]);

  return (
    <nav
      aria-label={`${heading} sections`}
      className="form-section-nav"
      data-tracking={current ? "" : undefined}
    >
      <p className="form-section-nav__heading">{heading}</p>
      <ol>
        {sections.map((section) => (
          <li key={section.id}>
            <a
              aria-current={current === section.id ? "location" : undefined}
              href={`#${section.id}`}
              onClick={() => setCurrent(section.id)}
            >
              {section.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
