import type { ApiClient } from "../../server/api.server.js";
import { systemSchema } from "./contracts.js";

export async function getSystemOperation({
  api,
  cookieHeader,
}: {
  api: ApiClient;
  cookieHeader: string;
}) {
  const { data } = await api({
    path: "/admin/v1/system",
    cookieHeader,
    responseSchema: systemSchema,
  });
  return data;
}
