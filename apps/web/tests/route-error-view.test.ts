import assert from "node:assert/strict";
import test from "node:test";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { RouteErrorView } from "../src/components/route-boundaries.js";

test("Try again on the route error view reloads the same URL as a new document", async () => {
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => createElement(RouteErrorView, { showNavigation: false }),
    }),
    history: createMemoryHistory({
      initialEntries: ["/events?q=night&from=2031-05-01"],
    }),
  });
  await router.load();

  const markup = renderToString(createElement(RouterProvider, { router }));
  const retry = markup.match(/<(a|button)[^>]*>Try again<\/\1>/)?.[0];

  // A plain link to the current URL, so the browser fetches the page and the
  // current build fresh, with or without JavaScript. No button refetches in
  // place.
  assert.equal(
    retry,
    '<a class="button button--primary" href="/events?q=night&amp;from=2031-05-01">Try again</a>',
  );
});
