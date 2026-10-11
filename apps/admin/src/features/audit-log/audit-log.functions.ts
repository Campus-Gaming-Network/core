import { createServerFn } from "@tanstack/react-start";
import { currentAdminRequest } from "../../server/admin-request.server.js";
import { listAuditLogOperation } from "./audit-log-operations.server.js";
import { auditLogInputSchema } from "./contracts.js";

export const getAuditLog = createServerFn({ method: "GET" })
  .validator(auditLogInputSchema)
  .handler(({ data }) =>
    listAuditLogOperation(data, currentAdminRequest(false)),
  );
