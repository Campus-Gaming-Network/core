import { createServerFn } from "@tanstack/react-start";
import {
  currentSessionRequest,
  goBFFForCurrentRequest,
  setPrivateNoStoreResponse,
} from "../../server/request-boundary.server.js";
import {
  defaultErrorReporter,
  homeCatalogOperation,
  schoolCatalogOperation,
  schoolsCatalogOperation,
  schoolStatsOperation,
  schoolViewerStateOperation,
} from "./catalog-operations.server.js";
import {
  schoolFilterInputSchema,
  schoolSlugInputSchema,
  schoolsBrowseInputSchema,
  schoolViewerInputSchema,
} from "./contracts.js";
import { loadSchoolFilterChoices } from "./school-filter.server.js";
import { gameFilterInputSchema } from "../game-picker/contracts.js";
import { loadGameFilterChoices } from "../game-picker/game-filter.server.js";

export const getHomeCatalog = createServerFn({ method: "GET" }).handler(
  async () => homeCatalogOperation({ api: goBFFForCurrentRequest() }),
);

export const getSchoolsCatalog = createServerFn({ method: "GET" })
  .validator(schoolsBrowseInputSchema)
  .handler(async ({ data }) =>
    schoolsCatalogOperation(data, { api: goBFFForCurrentRequest() }),
  );

/** The chosen game and `game_q` matches for a directory's game filter. */
export const getGameFilterChoices = createServerFn({ method: "GET" })
  .validator(gameFilterInputSchema)
  .handler(async ({ data }) =>
    loadGameFilterChoices(goBFFForCurrentRequest(), data, defaultErrorReporter),
  );

/** The chosen school and `school_q` matches for a directory's school filter. */
export const getSchoolFilterChoices = createServerFn({ method: "GET" })
  .validator(schoolFilterInputSchema)
  .handler(async ({ data }) =>
    loadSchoolFilterChoices(
      goBFFForCurrentRequest(),
      data,
      defaultErrorReporter,
    ),
  );

export const getSchoolCatalog = createServerFn({ method: "GET" })
  .validator(schoolSlugInputSchema)
  .handler(async ({ data }) =>
    schoolCatalogOperation(data, { api: goBFFForCurrentRequest() }),
  );

export const getSchoolStats = createServerFn({ method: "GET" })
  .validator(schoolSlugInputSchema)
  .handler(async ({ data }) =>
    schoolStatsOperation(data, { api: goBFFForCurrentRequest() }),
  );

export const getSchoolViewerState = createServerFn({ method: "GET" })
  .validator(schoolViewerInputSchema)
  .handler(async ({ data }) => {
    const request = currentSessionRequest();
    setPrivateNoStoreResponse();
    return schoolViewerStateOperation(data, {
      api: request.api,
      cookieHeader: request.cookieHeader,
      sessionCookieValue: request.sessionCookieValue,
    });
  });
