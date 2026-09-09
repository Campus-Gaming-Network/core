import { assertSafeEnvironment } from "./server/environment.server.ts";

// Nitro starts listening as soon as its generated entry is imported. Keep the
// configuration assertion in this small launcher so an unsafe production
// process exits before the generated server module can bind a port.
assertSafeEnvironment();

const nitroEntry = new URL("../.output/server/index.mjs", import.meta.url);
await import(nitroEntry.href);
