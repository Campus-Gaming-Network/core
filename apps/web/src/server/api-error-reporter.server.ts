import { ApiContractError, ApiError } from "./api.server.js";

/**
 * Builds the default error reporter for a server operations file. A contract
 * violation logs its path and issues, never the response body. Any failure
 * that is not an ApiError logs one generic line. Other ApiErrors are expected
 * outcomes and are not logged. The label starts each log message.
 */
export function apiErrorReporter(
  label: string,
  contractLabel: string = label,
): (error: unknown) => void {
  return (error) => {
    if (error instanceof ApiContractError) {
      console.error(`${contractLabel} response contract violation`, {
        path: error.path,
        issues: error.issues,
      });
    } else if (!(error instanceof ApiError)) {
      console.error(`${label} request failed`);
    }
  };
}
