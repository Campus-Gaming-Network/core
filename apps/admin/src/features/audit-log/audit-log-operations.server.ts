import type { ApiClient } from "../../server/api.server.js";
import { auditLogPageSchema, type AuditLogSearch } from "./contracts.js";

export async function listAuditLogOperation(
  search: AuditLogSearch,
  { api, cookieHeader }: { api: ApiClient; cookieHeader: string },
) {
  const query = new URLSearchParams({ limit: "25" });
  if (search.entity_type) query.set("entity_type", search.entity_type);
  if (search.after) query.set("after", search.after);
  if (search.before) query.set("before", search.before);
  const { data } = await api({
    path: `/admin/v1/audit?${query.toString()}`,
    cookieHeader,
    responseSchema: auditLogPageSchema,
  });
  return data;
}
