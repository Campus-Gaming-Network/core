import { createFileRoute } from "@tanstack/react-router";
import {
  adminHealthResponse,
  methodNotAllowedResponse
} from "../server/health.server";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: () => adminHealthResponse(),
      HEAD: () => adminHealthResponse(),
      POST: methodNotAllowedResponse,
      PUT: methodNotAllowedResponse,
      PATCH: methodNotAllowedResponse,
      DELETE: methodNotAllowedResponse,
      OPTIONS: methodNotAllowedResponse
    }
  }
});
