import { createFileRoute } from "@tanstack/react-router";
import {
  apiHealthResponse,
  methodNotAllowedResponse
} from "../server/health.server";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: () => apiHealthResponse(),
      HEAD: () => apiHealthResponse(),
      POST: methodNotAllowedResponse,
      PUT: methodNotAllowedResponse,
      PATCH: methodNotAllowedResponse,
      DELETE: methodNotAllowedResponse,
      OPTIONS: methodNotAllowedResponse
    }
  }
});
