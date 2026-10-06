import { createFileRoute } from "@tanstack/react-router";
import { errorMonitoringTestResponse } from "../server/error-monitor.server";

export const Route = createFileRoute("/api/error-monitoring-test")({
  server: {
    handlers: {
      POST: ({ request }) => errorMonitoringTestResponse(request),
    },
  },
});
