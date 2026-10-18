import { createServerFn } from "@tanstack/react-start";
import { goBFFForCurrentRequest } from "../../server/request-boundary.server.js";
import {
  clubDetailOperation,
  schoolClubsOperation,
} from "./club-operations.server.js";
import { clubSlugInputSchema } from "./contracts.js";

export const getClubDetail = createServerFn({ method: "GET" })
  .validator(clubSlugInputSchema)
  .handler(async ({ data }) =>
    clubDetailOperation(data, { api: goBFFForCurrentRequest() }),
  );

export const getSchoolClubs = createServerFn({ method: "GET" })
  .validator(clubSlugInputSchema)
  .handler(async ({ data }) =>
    schoolClubsOperation(data, { api: goBFFForCurrentRequest() }),
  );
