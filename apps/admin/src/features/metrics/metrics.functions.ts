import { createServerFn } from "@tanstack/react-start";
import { currentAdminRequest } from "../../server/admin-request.server.js";
import { getMetricsOperation } from "./metrics-operations.server.js";

export const getMetrics = createServerFn({ method: "GET" }).handler(() =>
  getMetricsOperation(currentAdminRequest(false)),
);
