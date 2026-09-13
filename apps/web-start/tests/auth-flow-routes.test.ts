import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import test from "node:test";

const currentDirectory = process.cwd();
const appRoot = basename(currentDirectory) === "web-start"
  ? currentDirectory
  : join(currentDirectory, "apps/web-start");

function source(relativePath: string) {
  return readFileSync(join(appRoot, relativePath), "utf8");
}

test("public auth routes are registered with the expected head and search contracts", () => {
  const routes = [
    ["signup.tsx", "/signup", false],
    ["forgot-password.tsx", "/forgot-password", true],
    ["reset-password.tsx", "/reset-password", true],
    ["auth.verify-email.tsx", "/auth/verify-email", true],
    ["auth.reset-password.tsx", "/auth/reset-password", true]
  ] as const;

  for (const [file, route, noIndex] of routes) {
    const routeSource = source(`src/routes/${file}`);
    assert.match(routeSource, new RegExp(`createFileRoute\\("${route}"\\)`));
    assert.match(routeSource, /authPageHead/);
    assert.equal(routeSource.includes("noIndex: true"), noIndex);
  }
});

test("signup keeps exact school search and native plus enhanced form behavior", () => {
  const route = source("src/routes/signup.tsx");
  const picker = source("src/features/auth-flow-slice/school-picker.tsx");
  const forms = source("src/features/auth-flow-slice/auth-forms.tsx");

  assert.match(route, /loaderDeps: \(\{ search \}\) => \(\{ query: search\.q \?\? "" \}\)/);
  assert.match(route, /<noscript>/);
  assert.match(route, /name="q"/);
  assert.match(picker, /<select[\s\S]*name="home_school_id"[\s\S]*required/);
  assert.match(picker, /placeholder="Search by school name"[\s\S]*type="search"/);
  assert.doesNotMatch(picker, /role="combobox"|role="listbox"|role="option"/);
  assert.match(picker, /Searching schools…/);
  assert.match(picker, /No schools found/);
  assert.match(picker, /Check your connection and try again/);
  assert.match(forms, /action=\{signup\.url\}/);
  assert.match(forms, /method="post"/);
  assert.match(forms, /name="age_confirmed"/);
  assert.match(forms, /fieldErrorProps/);
  assert.match(forms, /Account created\. Check your email/);
});

test("token routes never render secrets as text or place them in mutation redirects", () => {
  const reset = source("src/routes/reset-password.tsx");
  const verify = source("src/routes/auth.verify-email.tsx");
  const forms = source("src/features/auth-flow-slice/auth-forms.tsx");
  const functions = source("src/features/auth-flow-slice/auth-flow.functions.ts");

  assert.match(forms, /type="hidden" name="token" value=\{token\}/);
  assert.doesNotMatch(reset, />\s*\{search\.token\}\s*</);
  assert.doesNotMatch(verify, />\{search\.token\}</);
  assert.doesNotMatch(functions, /reset-password\?token=/);
  assert.match(functions, /\/login\?reset=complete/);
  assert.match(functions, /\/auth\/verify-email\?verified=complete/);
  assert.match(reset, /"cache-control": "private, no-store"/);
  assert.match(verify, /"cache-control": "private, no-store"/);
  assert.match(reset, /"referrer-policy": "no-referrer"/);
  assert.match(verify, /"referrer-policy": "no-referrer"/);
  assert.match(reset, /await establishPrivateAuthPage\(\)/);
  assert.match(verify, /await establishPrivateAuthPage\(\)/);
  assert.match(functions, /establishPrivateAuthPage[\s\S]*setPrivateNoStoreResponse\(\)/);
});

test("verification is explicit POST and missing or used links expose resend", () => {
  const verifyRoute = source("src/routes/auth.verify-email.tsx");
  const forms = source("src/features/auth-flow-slice/auth-forms.tsx");
  const functions = source("src/features/auth-flow-slice/auth-flow.functions.ts");

  assert.match(verifyRoute, /Select Verify email to finish confirming your address/);
  assert.match(verifyRoute, /<ResendVerificationForm/);
  assert.match(forms, /action=\{verifyEmail\.url\}/);
  assert.match(forms, /Need a new link\?/);
  assert.match(functions, /createServerFn\(\{[\s\S]*method: "POST"/);
  assert.match(functions, /setPrivateNoStoreResponse\(\)/);
  assert.doesNotMatch(verifyRoute, /getSignupSchools|verifyEmail\(\{/);
});

test("legacy reset route issues a temporary redirect before rendering", () => {
  const legacy = source("src/routes/auth.reset-password.tsx");
  assert.match(legacy, /beforeLoad/);
  assert.match(legacy, /await establishPrivateAuthPage\(\)/);
  assert.match(legacy, /legacyResetDestination\(search\.token \?\? ""\)/);
  assert.match(legacy, /statusCode: 307/);
  assert.doesNotMatch(legacy, /component:/);
});
