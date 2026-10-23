import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { getRouter } from "../src/router.js";

async function renderBoundary(content: ReactNode, href: string) {
  const router = createRouter({
    routeTree: createRootRoute({ component: () => content }),
    history: createMemoryHistory({ initialEntries: [href] }),
  });
  await router.load();
  return renderToString(createElement(RouterProvider, { router }));
}

test("the configured pending view announces loading and marks the page busy", async () => {
  const Pending = getRouter().options.defaultPendingComponent;
  assert.ok(Pending);
  const markup = await renderBoundary(createElement(Pending), "/");
  assert.match(markup, /aria-busy="true"/);
  assert.match(markup, /aria-live="polite"/);
  assert.match(markup, /Loading page…/);
});

test("the configured error view hides internal failures and retries with a document link", async () => {
  const ErrorView = getRouter().options.defaultErrorComponent;
  assert.ok(ErrorView);
  const markup = await renderBoundary(
    createElement(ErrorView, {
      error: new Error("secret-internal-error"),
      reset: () => {},
    }),
    "/?q=night",
  );
  assert.doesNotMatch(markup, /secret-internal-error/);
  assert.match(markup, /<a[^>]*href="\/\?q=night"[^>]*>Try again<\/a>/);
  assert.match(markup, /name="robots" content="noindex,nofollow"/);
});

test("the configured not-found view provides safe metadata and recovery links", async () => {
  const NotFound = getRouter().options.defaultNotFoundComponent;
  assert.ok(NotFound);
  const markup = await renderBoundary(createElement(NotFound), "/");
  assert.match(
    markup,
    /<title>Page not found \| Campus Gaming Network<\/title>/,
  );
  assert.match(markup, /name="robots" content="noindex,nofollow"/);
  assert.match(markup, /property="og:description"/);
  assert.match(markup, /name="twitter:description"/);
  assert.match(markup, /href="\/events"/);
  assert.match(markup, /href="\/schools"/);
  assert.match(markup, /href="\/teams"/);
});

test("the root error view keeps the site header and footer around a safe error", async () => {
  const RootError = getRouter().routeTree.options.errorComponent;
  assert.ok(RootError);
  const markup = await renderBoundary(
    createElement(RootError, {
      error: new Error("secret-root-error"),
      reset: () => {},
    }),
    "/",
  );
  assert.match(markup, /<header[^>]*>/);
  assert.match(markup, /<footer[^>]*>/);
  assert.match(markup, /We could not load this page/);
  assert.doesNotMatch(markup, /secret-root-error/);
});
