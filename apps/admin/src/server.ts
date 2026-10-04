import { accessGateResponse } from "./server/access-gate.server";
import {
  adminEnvironment,
  assertSafeEnvironment,
} from "./server/environment.server";
import {
  localAccessJWKSResponse,
  withLocalAccessAssertion,
} from "./server/local-access.server";

assertSafeEnvironment();

const { default: serverEntry } =
  await import("@tanstack/react-start/server-entry");

export default {
  ...serverEntry,
  async fetch(...args: Parameters<typeof serverEntry.fetch>) {
    const [request, ...rest] = args;
    const environment = adminEnvironment();
    const jwks = localAccessJWKSResponse(request, environment);
    if (jwks) return jwks;

    const authenticatedRequest = withLocalAccessAssertion(request, environment);
    const refusal = await accessGateResponse(authenticatedRequest, environment);
    return refusal ?? serverEntry.fetch(authenticatedRequest, ...rest);
  },
};
