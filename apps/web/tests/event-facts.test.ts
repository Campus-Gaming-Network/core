import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  EventFacts,
  EventTypeTag,
} from "../src/features/event-slice/event-facts.js";

test("an event of type other shows no type tag", () => {
  assert.equal(
    renderToStaticMarkup(createElement(EventTypeTag, { type: "other" })),
    "",
  );
  assert.equal(
    renderToStaticMarkup(
      createElement(EventFacts, {
        event: { event_type: "other", audience: undefined, cost: "free" },
      }),
    ),
    renderToStaticMarkup(
      createElement(EventFacts, {
        event: { event_type: undefined, audience: undefined, cost: "free" },
      }),
    ),
  );
});
