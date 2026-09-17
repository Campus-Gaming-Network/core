import { assertSafeEnvironment } from "./server/environment.server";

assertSafeEnvironment();

const { default: serverEntry } =
  await import("@tanstack/react-start/server-entry");

export default serverEntry;
