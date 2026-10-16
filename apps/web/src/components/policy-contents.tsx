import { useEffect, useState } from "react";

/**
 * The id of the section being read: the first one inside a band near the top
 * of the viewport, or the last one once the page is scrolled to the bottom
 * (the last section is often too short to reach the band). Null until
 * JavaScript runs, so server-rendered links carry no state.
 */
function useCurrentSection(idKey: string) {
  const [current, setCurrent] = useState<string | null>(null);

  useEffect(() => {
    const ids = idKey.split(" ");
    // A heading is a thin line that can slip past the band between scroll
    // events, so each one stands for the section around it.
    const targets = ids.flatMap((id) => {
      const heading = document.getElementById(id);
      return heading
        ? [{ id, element: heading.closest("section") ?? heading }]
        : [];
    });
    if (targets.length === 0 || !("IntersectionObserver" in window)) return;

    const idOf = new Map<Element, string>(
      targets.map(({ id, element }) => [element, id]),
    );
    const inView = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = idOf.get(entry.target);
          if (!id) continue;
          if (entry.isIntersecting) inView.add(id);
          else inView.delete(id);
        }
        const first = targets.find(({ id }) => inView.has(id));
        if (first) setCurrent(first.id);
      },
      { rootMargin: "-10% 0px -70% 0px" },
    );
    for (const { element } of targets) observer.observe(element);
    const onScroll = () => {
      if (
        window.innerHeight + window.scrollY >=
        document.documentElement.scrollHeight - 2
      ) {
        setCurrent(targets[targets.length - 1].id);
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
  }, [idKey]);

  return [current, setCurrent] as const;
}

/**
 * "On this page": links to a long document's headings. Wide screens get a
 * sticky list beside the text; phones get the same list collapsed in a
 * `<details>` so it does not push the text down. Both are plain anchor links,
 * so they work without JavaScript; with it, the section in view gets
 * `aria-current="location"`.
 */
export function PolicyContents({
  sections,
}: {
  sections: readonly { id: string; heading: string }[];
}) {
  const [current, setCurrent] = useCurrentSection(
    // A string, so the observer is not rebuilt on every render.
    sections.map((section) => section.id).join(" "),
  );
  const list = (
    <ol>
      {sections.map((section) => (
        <li key={section.id}>
          <a
            className="policy-contents__link"
            aria-current={current === section.id ? "location" : undefined}
            href={`#${section.id}`}
            onClick={() => setCurrent(section.id)}
          >
            {section.heading}
          </a>
        </li>
      ))}
    </ol>
  );
  return (
    <div className="policy-contents">
      <nav aria-label="On this page" className="policy-contents__wide">
        <p className="policy-contents__heading">On this page</p>
        {list}
      </nav>
      <details className="policy-contents__narrow">
        <summary>On this page</summary>
        <nav aria-label="On this page, short screens">{list}</nav>
      </details>
    </div>
  );
}
