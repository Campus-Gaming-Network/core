import { assertSafeEnvironment } from "./server/environment.server.ts";

// Validate before Nitro binds a privileged network listener.
assertSafeEnvironment();

const nitroEntry = new URL("../.output/server/index.mjs", import.meta.url);
await import(nitroEntry.href);
