import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import test from "node:test";
import { publicPageHead } from "../src/components/public-page-head.js";

const currentDirectory = process.cwd();
const appRoot =
  basename(currentDirectory) === "web"
    ? currentDirectory
    : join(currentDirectory, "apps/web");

function source(relativePath: string) {
  return readFileSync(join(appRoot, relativePath), "utf8");
}

const pages = [
  {
    route: "/about",
    file: "about.tsx",
    title: "About",
    description:
      "How Campus Gaming Network connects collegiate gamers with events, teams, and campus activity.",
    heading: "Campus Gaming Network connects collegiate gaming communities."
  },
  {
    route: "/faq",
    file: "faq.tsx",
    title: "FAQ",
    description:
      "Answers to common questions about accounts, events, teams, and schools on Campus Gaming Network.",
    heading: "Frequently asked questions."
  },
  {
    route: "/privacy",
    file: "privacy.tsx",
    title: "Privacy",
    description:
      "How Campus Gaming Network collects, uses, and protects your information.",
    heading: "Privacy placeholder"
  },
  {
    route: "/terms",
    file: "terms.tsx",
    title: "Terms",
    description: "The terms of service for using Campus Gaming Network.",
    heading: "Terms placeholder"
  },
  {
    route: "/support",
    file: "support.tsx",
    title: "Support",
    description:
      "Get help with Campus Gaming Network or send the team a support request.",
    heading: "Need help?"
  }
] as const;

test("static routes preserve the public, indexable metadata contract", () => {
  for (const page of pages) {
    const head = publicPageHead("https://cgn.example", {
      title: page.title,
      description: page.description,
      path: page.route
    });

    assert.deepEqual(head.meta[0], {
      title: `${page.title} | Campus Gaming Network`
    });
    assert.ok(
      head.meta.some(
        (entry) =>
          entry.name === "description" && entry.content === page.description
      )
    );
    assert.ok(
      head.meta.some(
        (entry) =>
          entry.property === "og:url" &&
          entry.content === `https://cgn.example${page.route}`
      )
    );
    assert.ok(
      head.meta.some(
        (entry) =>
          entry.name === "twitter:title" &&
          entry.content === `${page.title} | Campus Gaming Network`
      )
    );
    assert.equal(
      head.meta.some((entry) => entry.name === "robots"),
      false,
      `${page.route} must remain indexable`
    );
  }
});

test("static routes are SSR loader-backed and do not fetch viewer state themselves", () => {
  for (const page of pages) {
    const routeSource = source(`src/routes/${page.file}`);

    assert.match(routeSource, new RegExp(`createFileRoute\\("${page.route}"\\)`));
    assert.match(
      routeSource,
      /loader: \(\{ context \}\) => context\.publicOrigin/
    );
    assert.match(routeSource, new RegExp(page.heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(routeSource, /getEventViewerSession|createServerFn|["']\/me["']/);
  }
});

test("FAQ keeps an accessible disclosure and the current answers", () => {
  const faq = source("src/routes/faq.tsx");

  assert.match(faq, /<details key=\{item\.question\}>/);
  assert.match(faq, /<summary>\{item\.question\}<\/summary>/);
  assert.match(faq, /Can any school be listed\?/);
  assert.match(faq, /Do I need to verify my email\?/);
  assert.match(faq, /Can I create events yet\?/);
  assert.match(faq, /yes RSVPs send confirmation emails with calendar files/);
});

test("support renders the migrated A09 form without the Phase 4 placeholder", () => {
  const support = source("src/routes/support.tsx");

  assert.match(support, /SupportTicketForm/);
  assert.match(support, /validateSupportSearch/);
  assert.doesNotMatch(support, /supportMutationGap|migrated in Phase 4/);
});

test("newly registered static destinations use typed internal links", () => {
  const root = source("src/routes/__root.tsx");
  const boundaries = source("src/components/route-boundaries.tsx");

  for (const route of ["/about", "/faq", "/privacy", "/terms", "/support"]) {
    assert.match(root, new RegExp(`<Link to="${route}">`));
    assert.doesNotMatch(root, new RegExp(`<a href="${route}">`));
  }
  assert.match(boundaries, /<Link to="\/support">Contact support<\/Link>/);
  assert.match(root, /<Link to="\/events">/);
  assert.match(root, /<Link to="\/teams">/);
  assert.doesNotMatch(root, /<a href="\/(?:events|teams)">/);
});
