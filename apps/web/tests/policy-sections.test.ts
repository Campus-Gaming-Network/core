import assert from "node:assert/strict";
import test from "node:test";
import { anchoredSections } from "../src/components/policy-sections.js";

test("sections keep their own id, else a slug of the heading, and never share one", () => {
  const paragraphs = ["x"];
  assert.deepEqual(
    anchoredSections([
      { id: "fees", heading: "What we charge", paragraphs },
      { heading: "Your data & rights", paragraphs },
      { heading: "Your data rights", paragraphs },
      { id: "fees", heading: "Fees again", paragraphs },
      { heading: "???", paragraphs },
    ]),
    [
      { id: "fees", heading: "What we charge", paragraphs },
      { id: "your-data-rights", heading: "Your data & rights", paragraphs },
      { id: "your-data-rights-2", heading: "Your data rights", paragraphs },
      { id: "fees-2", heading: "Fees again", paragraphs },
      { id: "section", heading: "???", paragraphs },
    ],
  );
});
