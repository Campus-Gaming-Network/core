import { createFileRoute } from "@tanstack/react-router";
import { robotsTxtResponse } from "../features/seo-slice/seo.server";
import {
  runtimeEnvironment,
  validatedPublicOrigin,
} from "../server/environment.server";
import { methodNotAllowedResponse } from "../server/health.server";

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: handleRobotsRequest,
      HEAD: handleRobotsRequest,
      POST: methodNotAllowedResponse,
      PUT: methodNotAllowedResponse,
      PATCH: methodNotAllowedResponse,
      DELETE: methodNotAllowedResponse,
      OPTIONS: methodNotAllowedResponse,
    },
  },
});

function handleRobotsRequest(): Response {
  return robotsTxtResponse({
    deploymentEnvironment: runtimeEnvironment(),
    publicOrigin: validatedPublicOrigin(),
  });
}
