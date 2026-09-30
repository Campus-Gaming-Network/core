import { createRouter } from "@tanstack/react-router";
import { createIsomorphicFn } from "@tanstack/react-start";
import {
  DefaultError,
  DefaultNotFound,
  DefaultPending,
} from "./components/route-boundaries";
import { currentRequestNonce } from "./server/request-nonce.server";
import { routeTree } from "./routeTree.gen";

// On the server, the router stamps this request's CSP nonce on the inline
// scripts it renders. The browser has no nonce to give.
const serverNonce = createIsomorphicFn()
  .server(() => currentRequestNonce())
  .client(() => undefined);

export function getRouter() {
  return createRouter({
    routeTree,
    defaultPendingComponent: DefaultPending,
    defaultErrorComponent: DefaultError,
    defaultNotFoundComponent: DefaultNotFound,
    scrollRestoration: true,
    ssr: { nonce: serverNonce() },
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
