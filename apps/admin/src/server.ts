import { accessGateResponse } from "./server/access-gate.server";
import {
  adminEnvironment,
  assertSafeEnvironment,
} from "./server/environment.server";

assertSafeEnvironment();

const { default: serverEntry } =
  await import("@tanstack/react-start/server-entry");

export default {
  ...serverEntry,
  async fetch(...args: Parameters<typeof serverEntry.fetch>) {
    const refusal = await accessGateResponse(args[0], adminEnvironment());
    return refusal ?? serverEntry.fetch(...args);
  },
};
