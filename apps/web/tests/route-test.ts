import assert from "node:assert/strict";
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRouter,
  RouterProvider,
  type AnyRoute,
} from "@tanstack/react-router";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

/** Mount a real file route without importing the generated application's tree. */
export async function loadRoute(route: AnyRoute, path: string, href = path) {
  const root = createRootRouteWithContext<{ publicOrigin: string }>()({
    loader: () => ({ renderedAt: Date.parse("2037-02-19T18:00:00Z") }),
  });
  // File routes receive these values from routeTree.gen.ts in the app.
  Object.assign(route.options, { path, getParentRoute: () => root });
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: [href] }),
    context: { publicOrigin: "https://cgn.test" },
    isServer: true,
  });
  await router.load();
  return {
    router,
    // The same server result consumed by TanStack's HTTP request handler.
    // oxlint-disable-next-line no-underscore-dangle -- Isolate the framework's SSR result access in this adapter.
    response: router._serverResult,
    match: router.state.matches.at(-1),
    render: () => {
      const markup = renderToString(createElement(RouterProvider, { router }));
      assert.doesNotMatch(markup, /Switched to client rendering/);
      return markup;
    },
  };
}
