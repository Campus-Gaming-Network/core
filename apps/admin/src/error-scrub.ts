import type { ErrorEvent } from "@sentry/browser";

// Applied to every error report, in the server and in the browser, so that an
// error message or URL that names a person or carries a credential does not
// reach Sentry. docs/16-legal-and-data-lifecycle-plan.md owns the policy.

export const REDACTED = "[redacted]";

const emailPattern = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const sensitiveParameterPattern =
  /\b((?:[a-z_]*(?:token|secret|password|passwd|api_?key|signature))=)[^&\s"'#]+/gi;
const bearerPattern = /\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const sensitiveKeyPattern =
  /password|passwd|secret|token|authorization|cookie|api_?key|email|recipient|dsn|csrf/i;

export function scrubText(text: string): string {
  return text
    .replace(emailPattern, "[email]")
    .replace(sensitiveParameterPattern, `$1${REDACTED}`)
    .replace(bearerPattern, `$1 ${REDACTED}`);
}

// Removes the query string and fragment, which carry tokens and search terms.
export function stripQuery(url: string): string {
  return url.split(/[?#]/)[0] ?? "";
}

function scrubRecord(record: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(record)) {
    if (sensitiveKeyPattern.test(key)) {
      record[key] = REDACTED;
    } else if (typeof value === "string") {
      record[key] = scrubText(value);
    }
  }
}

export function scrubEvent(
  event: ErrorEvent,
  options: { keepUrl: boolean } = { keepUrl: false },
): ErrorEvent {
  const url = options.keepUrl ? event.request?.url : undefined;
  event.request = url ? { url: scrubText(stripQuery(url)) } : undefined;
  delete event.user;
  delete event.breadcrumbs;
  delete event.server_name;
  if (event.message) event.message = scrubText(event.message);
  if (event.transaction) event.transaction = scrubText(event.transaction);
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = scrubText(exception.value);
    for (const frame of exception.stacktrace?.frames ?? []) {
      delete frame.vars;
    }
  }
  if (event.tags) scrubRecord(event.tags);
  if (event.extra) scrubRecord(event.extra);
  for (const context of Object.values(event.contexts ?? {})) {
    if (context) scrubRecord(context);
  }
  return event;
}
