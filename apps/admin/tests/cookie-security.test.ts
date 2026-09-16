import assert from "node:assert/strict";
import test from "node:test";
import {
  adminCookieHeader,
  mirroredAdminCookies
} from "../src/server/cookies.server.js";

const names = {
  session: "__Host-cgn_admin_session",
  csrf: "__Host-cgn_admin_csrf"
};

test("only isolated admin cookies are forwarded", () => {
  assert.equal(
    adminCookieHeader(names.session, "session", names.csrf, "csrf"),
    "__Host-cgn_admin_session=session; __Host-cgn_admin_csrf=csrf"
  );
});

test("secure strict session and CSRF cookies are mirrored atomically", () => {
  const headers = new Headers();
  headers.append(
    "set-cookie",
    `${names.session}=session; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=600`
  );
  headers.append(
    "set-cookie",
    `${names.csrf}=csrf; Path=/; Secure; SameSite=Strict; Max-Age=600`
  );

  const mutations = mirroredAdminCookies(headers, names, true);
  assert.equal(mutations?.length, 2);
  assert.equal(mutations?.[0]?.kind, "set");
  assert.equal(mutations?.[1]?.kind, "set");
});

test("cookies with a Domain or relaxed SameSite policy are rejected", () => {
  const headers = new Headers();
  headers.append(
    "set-cookie",
    `${names.session}=session; Path=/; Domain=example.com; Secure; HttpOnly; SameSite=Strict`
  );
  headers.append(
    "set-cookie",
    `${names.csrf}=csrf; Path=/; Secure; SameSite=Lax`
  );
  assert.equal(mirroredAdminCookies(headers, names, true), null);
});
