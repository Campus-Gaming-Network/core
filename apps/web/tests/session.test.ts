import assert from "node:assert/strict";
import test from "node:test";
import { hasSessionCookie } from "../lib/session.js";

test("recognizes only a non-empty, exact session cookie", () => {
  assert.equal(hasSessionCookie("theme=dark; cgn_session=opaque", "cgn_session"), true);
  assert.equal(hasSessionCookie("cgn_session_extra=opaque", "cgn_session"), false);
  assert.equal(hasSessionCookie("cgn_session=", "cgn_session"), false);
  assert.equal(hasSessionCookie("", "cgn_session"), false);
});

test("supports a configured session cookie name", () => {
  assert.equal(hasSessionCookie("custom_session=value", "custom_session"), true);
  assert.equal(hasSessionCookie("cgn_session=value", "custom_session"), false);
});
