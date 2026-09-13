import { createServerFn } from "@tanstack/react-start";
import {
  currentSessionRequest,
  goBFFForCurrentRequest,
  setPrivateNoStoreResponse
} from "../../server/request-boundary.server.js";
import {
  homeCatalogOperation,
  schoolCatalogOperation,
  schoolsCatalogOperation,
  schoolViewerStateOperation
} from "./catalog-operations.server.js";
import {
  schoolSlugInputSchema,
  schoolsBrowseInputSchema,
  schoolViewerInputSchema
} from "./contracts.js";

export const getHomeCatalog = createServerFn({ method: "GET" }).handler(
  async () => homeCatalogOperation({ api: goBFFForCurrentRequest() })
);

export const getSchoolsCatalog = createServerFn({ method: "GET" })
  .validator(schoolsBrowseInputSchema)
  .handler(async ({ data }) =>
    schoolsCatalogOperation(data, { api: goBFFForCurrentRequest() })
  );

export const getSchoolCatalog = createServerFn({ method: "GET" })
  .validator(schoolSlugInputSchema)
  .handler(async ({ data }) =>
    schoolCatalogOperation(data, { api: goBFFForCurrentRequest() })
  );

export const getSchoolViewerState = createServerFn({ method: "GET" })
  .validator(schoolViewerInputSchema)
  .handler(async ({ data }) => {
    const request = currentSessionRequest();
    setPrivateNoStoreResponse();
    return schoolViewerStateOperation(data, {
      api: request.api,
      cookieHeader: request.cookieHeader,
      sessionCookieValue: request.sessionCookieValue
    });
  });
