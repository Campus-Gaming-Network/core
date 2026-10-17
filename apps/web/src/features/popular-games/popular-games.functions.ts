import { createServerFn } from "@tanstack/react-start";
import { goBFFForCurrentRequest } from "../../server/request-boundary.server.js";
import { popularGamesInputSchema } from "./contracts.js";
import { popularGamesOperation } from "./popular-games-operations.server.js";

export const getPopularGames = createServerFn({ method: "GET" })
  .validator(popularGamesInputSchema)
  .handler(async ({ data }) =>
    popularGamesOperation(data, { api: goBFFForCurrentRequest() }),
  );
