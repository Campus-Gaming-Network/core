import { type ApiClient } from "../../server/api.server.js";
import { apiErrorReporter } from "../../server/api-error-reporter.server.js";
import {
  popularGamesResponseSchema,
  type PopularGamesInput,
  type PopularGamesResult,
} from "./contracts.js";

export async function popularGamesOperation(
  { school }: PopularGamesInput,
  {
    api,
    reportError = defaultErrorReporter,
  }: { api: ApiClient; reportError?: (error: unknown) => void },
): Promise<PopularGamesResult> {
  const search = new URLSearchParams();
  if (school) search.set("school", school);
  const query = search.size > 0 ? `?${search}` : "";
  try {
    const { data } = await api({
      path: `/popular-games${query}`,
      responseSchema: popularGamesResponseSchema,
    });
    return { status: "ready", games: data.games };
  } catch (error) {
    reportError(error);
    return { status: "unavailable" };
  }
}

const defaultErrorReporter = apiErrorReporter("Popular games");
