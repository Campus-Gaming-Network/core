import { createServerFn } from "@tanstack/react-start";
import { currentAdminRequest } from "../../server/admin-request.server.js";
import { getSystemOperation } from "./system-operations.server.js";

export const getSystem = createServerFn({ method: "GET" }).handler(() =>
  getSystemOperation(currentAdminRequest(false)),
);
