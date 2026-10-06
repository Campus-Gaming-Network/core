import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import test from "node:test";

const currentDirectory = process.cwd();
const appRoot =
  basename(currentDirectory) === "web"
    ? currentDirectory
    : join(currentDirectory, "apps/web");

function source(relativePath: string) {
  return readFileSync(join(appRoot, relativePath), "utf8");
}

test("token routes never render secrets as text or place them in mutation redirects", () => {
  const reset = source("src/routes/reset-password.tsx");
  const verify = source("src/routes/auth.verify-email.tsx");
  const forms = source("src/features/auth-flow-slice/auth-forms.tsx");
  const functions = source(
    "src/features/auth-flow-slice/auth-flow.functions.ts",
  );

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
  assert.match(
    functions,
    /establishPrivateAuthPage[\s\S]*setPrivateNoStoreResponse\(\)/,
  );
});
