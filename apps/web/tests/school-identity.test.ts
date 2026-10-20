import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  schoolMonogram,
  schoolTone,
  schoolToneCount,
} from "../src/components/school-identity.js";
import { SchoolMark } from "../src/components/school-mark.js";

test("schoolMonogram takes the first two words that name the school", () => {
  assert.deepEqual(
    [
      "Sacred Heart University",
      "University of Northern Plains",
      "College of the Pines",
      "The University of the Coast",
      "Lakeshore State College",
      "Summit Ridge University-East Campus",
      "Texas A & M University",
      "Université de Montréal",
      "Universidad del Sagrado Corazón",
      "University College",
      "Del-Mar-Va Beauty Academy",
    ].map(schoolMonogram),
    ["SH", "NP", "P", "C", "LS", "SR", "TA", "M", "SC", "UC", "D"],
  );
});

test("schoolTone is fixed by the slug and reaches every tone", () => {
  const slugs = Array.from({ length: 200 }, (_, index) => `school-${index}`);
  const tones = slugs.map(schoolTone);
  assert.deepEqual(slugs.map(schoolTone), tones);
  assert.deepEqual(
    new Set(tones),
    new Set(Array.from({ length: schoolToneCount }, (_, index) => index)),
  );
});

test("SchoolMark shows the monogram on the school's tone under its logo", () => {
  assert.equal(
    renderToStaticMarkup(
      createElement(SchoolMark, {
        className: "school-select__mark",
        logoURL: "/school-logos/example.png",
        name: "University of Northern Plains",
        size: 32,
        slug: "northern-plains",
      }),
    ),
    `<span aria-hidden="true" class="school-directory-mark school-select__mark" data-school-tone="${schoolTone("northern-plains")}">NP<img alt="" class="school-logo" decoding="async" height="32" loading="lazy" referrerPolicy="no-referrer" src="/school-logos/example.png" width="32"/></span>`,
  );
});
