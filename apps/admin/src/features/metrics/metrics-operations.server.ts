import type { ApiClient } from "../../server/api.server.js";
import { metricsSchema } from "./contracts.js";

export async function getMetricsOperation({
  api,
  cookieHeader,
}: {
  api: ApiClient;
  cookieHeader: string;
}) {
  const { data } = await api({
    path: "/admin/v1/metrics",
    cookieHeader,
    responseSchema: metricsSchema,
  });
  return data;
}
