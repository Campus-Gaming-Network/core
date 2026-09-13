import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import test from "node:test";

const currentDirectory = process.cwd();
const appRoot = basename(currentDirectory) === "web"
  ? currentDirectory
  : join(currentDirectory, "apps/web");

function source(relativePath: string) {
  return readFileSync(join(appRoot, relativePath), "utf8");
}

test("support route keeps indexable metadata and renders the real form", () => {
  const route = source("src/routes/support.tsx");

  assert.match(route, /createFileRoute\("\/support"\)/);
  assert.match(route, /validateSearch: validateSupportSearch/);
  assert.match(route, /loader: \(\{ context \}\) => context\.publicOrigin/);
  assert.match(route, /publicPageHead/);
  assert.doesNotMatch(route, /noIndex|supportMutationGap|migrated in Phase 4/);
  assert.match(route, /<SupportTicketForm initialStatus=\{search\.support\} \/>/);
});

test("support form preserves native constraints and accessible enhanced errors", () => {
  const form = source("src/features/support-slice/support-ticket-form.tsx");

  assert.match(form, /action=\{submitSupportTicket\.url\}/);
  assert.match(form, /method="post"/);
  assert.match(form, /onSubmit=\{submit\}/);
  assert.match(form, /name="contact_email"[\s\S]*type="email"[\s\S]*required/);
  assert.match(form, /name="name"[\s\S]*maxLength=\{120\}/);
  assert.match(form, /name="subject"[\s\S]*required[\s\S]*maxLength=\{160\}/);
  assert.match(form, /name="message"[\s\S]*required[\s\S]*maxLength=\{5000\}/);
  assert.match(form, /fieldErrorProps/);
  assert.match(form, /FieldError/);
  assert.match(form, /role=\{status === "error" \? "alert" : "status"\}/);
  assert.match(form, /Do not include passwords/);
});

test("support function derives trust and cookies server-side with safe native redirects", () => {
  const functions = source("src/features/support-slice/support.functions.ts");

  assert.match(functions, /createServerFn\(\{[\s\S]*method: "POST"/);
  assert.match(functions, /currentSessionRequest\(\)/);
  assert.match(functions, /api: request\.api/);
  assert.match(functions, /cookieHeader: request\.cookieHeader/);
  assert.match(functions, /setPrivateNoStoreResponse\(\)/);
  assert.match(functions, /isNativeFormPost\(\)/);
  assert.match(functions, /statusCode: 303/);
  assert.match(functions, /\/support\?support=/);
  assert.doesNotMatch(functions, /contact_email|x-cgn-visitor-ip|x-cgn-proxy-secret/);
});
