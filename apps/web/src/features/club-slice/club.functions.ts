import { createServerFn } from "@tanstack/react-start";
import { goBFFForCurrentRequest } from "../../server/request-boundary.server.js";
import {
  clubDetailOperation,
  clubsBrowsePageOperation,
  schoolClubsOperation,
} from "./club-operations.server.js";
import {
  clubsBrowsePageInputSchema,
  clubSlugInputSchema,
} from "./contracts.js";

export const getClubsBrowsePage = createServerFn({ method: "GET" })
  .validator(clubsBrowsePageInputSchema)
  .handler(async ({ data }) =>
    clubsBrowsePageOperation(data, { api: goBFFForCurrentRequest() }),
  );

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
