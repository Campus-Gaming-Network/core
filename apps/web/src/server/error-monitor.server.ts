import { timingSafeEqual } from "node:crypto";
import * as Sentry from "@sentry/node";
import { isNotFound, isRedirect } from "@tanstack/react-router";
import { ApiError } from "./api.server.js";

type Environment = Readonly<Record<string, string | undefined>>;

// The browser reports to the same project, so this is also what the root route
// hands to the page. A DSN is a public ingest key, not a secret.
export type ErrorMonitoringConfig = {
  dsn: string;
  environment: string;
  release: string | undefined;
};

const reported = new WeakSet<object>();

export function errorMonitoringConfig(
  environment: Environment = process.env,
): ErrorMonitoringConfig | null {
  const dsn = environment.SENTRY_DSN?.trim();
  if (!dsn) return null;

  return {
    dsn,
    environment: environment.DEPLOYMENT_ENV?.trim().toLowerCase() || "local",
    release:
      environment.SENTRY_RELEASE?.trim() ||
      environment.RAILWAY_GIT_COMMIT_SHA?.trim() ||
      undefined,
  };
}

// Reporting is explicit: no default integration runs, so an event holds the
// error and its stack trace and never a request, cookie, header, or user.
export function startErrorMonitoring(
  environment: Environment = process.env,
): void {
  const config = errorMonitoringConfig(environment);
  if (!config) {
    const deployment = environment.DEPLOYMENT_ENV?.trim().toLowerCase();
    if (deployment === "staging" || deployment === "production") {
      console.warn("error monitoring is disabled; set SENTRY_DSN to enable it");
    }
    return;
  }

  Sentry.init({
    ...config,
    defaultIntegrations: false,
    initialScope: { tags: { runtime: "server" } },
    beforeSend(event) {
      delete event.request;
      delete event.user;
      delete event.breadcrumbs;
      return event;
    },
  });
}

// Redirects, not-found results, ready-made responses, and API rejections of
// the visitor's own request are expected outcomes rather than failures.
export function reportServerError(error: unknown): void {
  if (
    isRedirect(error) ||
    isNotFound(error) ||
    error instanceof Response ||
    (error instanceof ApiError && error.status < 500)
  ) {
    return;
  }
  // A server function failure passes the function middleware and then the
  // request middleware.
  if (typeof error === "object" && error !== null) {
    if (reported.has(error)) return;
    reported.add(error);
  }

  Sentry.captureException(error);
}

// Throws on purpose so an operator can confirm that a deployment's failures
// reach the error monitoring project. Disabled unless WEB_MAINTENANCE_TOKEN is
// set.
export function errorMonitoringTestResponse(
  request: Request,
  environment: Environment = process.env,
): Response {
  const token = environment.WEB_MAINTENANCE_TOKEN?.trim();
  if (!token) return new Response(null, { status: 404 });

  const provided = Buffer.from(
    request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "",
  );
  const expected = Buffer.from(token);
  if (
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  ) {
    return new Response(null, { status: 401 });
  }

  throw new Error("error monitoring test");
}
