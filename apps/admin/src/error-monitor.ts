import * as Sentry from "@sentry/browser";
import { scrubEvent } from "./error-scrub";
import type { ErrorMonitoringConfig } from "./server/error-monitor.server";

// Loaded on demand by the root route, so a deployment without a DSN never
// downloads the SDK. It ships in the console's own bundle; nothing is fetched
// from another origin.
export function startBrowserErrorMonitoring(
  config: ErrorMonitoringConfig,
): void {
  if (Sentry.getClient()) return;

  Sentry.init({
    ...config,
    // Breadcrumbs record clicked elements, console output, and request URLs.
    // Session tracking contacts Sentry on every page load; without it the
    // browser contacts Sentry only to report an error.
    integrations: (integrations) =>
      integrations.filter(
        (integration) =>
          integration.name !== "Breadcrumbs" &&
          integration.name !== "BrowserSession",
      ),
    initialScope: { tags: { runtime: "browser" } },
    // Query strings carry search terms and filters, which can name a person.
    beforeSend: (event) => scrubEvent(event, { keepUrl: true }),
  });
}

// React error boundaries swallow render and loader errors before the SDK's
// global handlers see them.
export function reportBrowserError(error: unknown): void {
  Sentry.captureException(error);
}
