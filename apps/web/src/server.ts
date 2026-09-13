import { assertSafeEnvironment } from "./server/environment.server";

// Keep this check ahead of the application handler import so an unsafe
// environment cannot initialize route or server-function code. Nitro currently
// lazy-loads this entry after its listener starts; validating before the listener
// binds requires a separate production launcher or Nitro startup hook.
assertSafeEnvironment();

const { default: serverEntry } = await import(
  "@tanstack/react-start/server-entry"
);

export default serverEntry;
