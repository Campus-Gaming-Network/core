import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EventTimeText } from "../src/features/event-slice/event-time-text.js";

test("a time range breaks only between its date, start, and end", () => {
  assert.equal(
    renderToStaticMarkup(
      createElement(EventTimeText, {
        range: "Oct 14, 10:45 PM – 11:45 PM CDT",
      }),
    ),
    '<span class="nowrap">Oct 14</span>, <span class="nowrap">10:45 PM</span> – <span class="nowrap">11:45 PM CDT</span>',
  );
});
