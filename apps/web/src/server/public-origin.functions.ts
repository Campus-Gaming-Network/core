import { createServerFn } from "@tanstack/react-start";
import { validatedPublicOrigin } from "./environment.server.js";
import { errorMonitoringConfig } from "./error-monitor.server.js";

// One request serves both values because the root route asks on every
// navigation.
export const getPublicRuntimeConfig = createServerFn({ method: "GET" }).handler(
  () => ({
    errorMonitoring: errorMonitoringConfig(),
    publicOrigin: validatedPublicOrigin(),
  }),
);
