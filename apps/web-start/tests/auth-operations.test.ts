import assert from "node:assert/strict";
import test from "node:test";
import { createApiClient, type Fetcher } from "../src/server/api.server.js";
import type { CookieMutation } from "../src/server/cookies.server.js";
import {
  getEventViewerSessionOperation,
  getNavigationSessionOperation,
  loginOperation,
  logoutOperation,
  safeLocalNext
} from "../src/features/event-slice/auth-operations.server.js";
import { validateLoginServerInput } from "../src/features/event-slice/contracts.js";

const profile = {
  id: "user-1",
  email: "player@example.com",
  verification_level: "basic",
  name: "Player One",
  timezone: "America/Los_Angeles",
  home_school_id: "school-1"
};

function client(fetcher: Fetcher) {
  return createApiClient({
    incomingHeaders: new Headers({ "x-real-ip": "203.0.113.42" }),
    proxySecret: "proxy-secret",
    baseUrl: "http://api:8080",
    fetcher
  });
}

test("navigation session is a no-store viewer read and degrades safely", async () => {
  let init: RequestInit | undefined;
  const authenticated = await getNavigationSessionOperation({
    api: client(async (_input, requestInit) => {
      init = requestInit;
      return Response.json(profile);
    }),
    cookieHeader: "cgn_session=session-value",
    sessionCookieValue: "session-value"
  });
  const unavailable = await getNavigationSessionOperation({
    api: client(async () => {
      throw new Error("upstream host and credentials must not escape");
    }),
    cookieHeader: "cgn_session=session-value",
    sessionCookieValue: "session-value"
  });

  assert.deepEqual(authenticated, { authenticated: true });
  assert.equal(init?.cache, "no-store");
  assert.equal(new Headers(init?.headers).get("cookie"), "cgn_session=session-value");
  assert.deepEqual(unavailable, { authenticated: false });
});

test("navigation does not call /me for an unrelated cookie", async () => {
  let called = false;
  const result = await getNavigationSessionOperation({
    api: client(async () => {
      called = true;
      return Response.json(profile);
    }),
    cookieHeader: "analytics=value",
    sessionCookieValue: undefined
  });

  assert.deepEqual(result, { authenticated: false });
  assert.equal(called, false);
});

test("strict event viewer session distinguishes logged out, authenticated, and 401", async () => {
  let calls = 0;
  const api = client(async () => {
    calls += 1;
    return Response.json(profile);
  });
  const noSession = await getEventViewerSessionOperation({
    api,
    cookieHeader: "analytics=value",
    sessionCookieValue: undefined
  });
  const authenticated = await getEventViewerSessionOperation({
    api,
    cookieHeader: "cgn_session=session-value",
    sessionCookieValue: "session-value"
  });
  const expired = await getEventViewerSessionOperation({
    api: client(async () =>
      Response.json({ error: "authentication_required" }, { status: 401 })
    ),
    cookieHeader: "cgn_session=expired",
    sessionCookieValue: "expired"
  });

  assert.deepEqual(noSession, {
    status: "unauthenticated",
    authenticated: false
  });
  assert.deepEqual(authenticated, {
    status: "authenticated",
    authenticated: true
  });
  assert.deepEqual(expired, {
    status: "unauthenticated",
    authenticated: false
  });
  assert.equal(calls, 1);
});

test("strict event viewer session never masks upstream unavailability as logged out", async () => {
  const unavailable = {
    status: "unavailable" as const,
    message: "We could not verify your session. Please try again." as const
  };
  const network = await getEventViewerSessionOperation({
    api: client(async () => {
      throw new Error("private upstream details");
    }),
    cookieHeader: "cgn_session=session-value",
    sessionCookieValue: "session-value",
    reportError: () => undefined
  });
  const serverError = await getEventViewerSessionOperation({
    api: client(async () =>
      Response.json({ error: "database_unavailable" }, { status: 503 })
    ),
    cookieHeader: "cgn_session=session-value",
    sessionCookieValue: "session-value",
    reportError: () => undefined
  });
  const contractError = await getEventViewerSessionOperation({
    api: client(async () => Response.json({ unexpected: true })),
    cookieHeader: "cgn_session=session-value",
    sessionCookieValue: "session-value",
    reportError: () => undefined
  });

  assert.deepEqual(network, unavailable);
  assert.deepEqual(serverError, unavailable);
  assert.deepEqual(contractError, unavailable);
  assert.equal(JSON.stringify(network).includes("upstream"), false);
});

test("login sends only credentials and mirrors the named upstream session cookie", async () => {
  let init: RequestInit | undefined;
  const mutations: CookieMutation[] = [];
  const result = await loginOperation(
    {
      email: "player@example.com",
      password: "Password12345!",
      next: "/events/private-event"
    },
    {
      api: client(async (_input, requestInit) => {
        init = requestInit;
        return Response.json(profile, {
          headers: {
            "set-cookie":
              "cgn_session=session-token; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600"
          }
        });
      }),
      sessionCookieName: "cgn_session",
      applyCookie: (mutation) => mutations.push(mutation)
    }
  );

  assert.equal(
    init?.body,
    JSON.stringify({
      email: "player@example.com",
      password: "Password12345!"
    })
  );
  assert.deepEqual(result, {
    status: "success",
    authenticated: true,
    redirectTo: "/events/private-event"
  });
  assert.deepEqual(mutations, [
    {
      kind: "set",
      name: "cgn_session",
      value: "session-token",
      options: {
        path: "/",
        expires: undefined,
        maxAge: 3600,
        httpOnly: true,
        secure: true,
        sameSite: "lax"
      }
    }
  ]);
  assert.equal(JSON.stringify(result).includes("session-token"), false);
});

test("login accepts only local next paths", async () => {
  assert.equal(safeLocalNext("/account?tab=events"), "/account?tab=events");
  assert.equal(safeLocalNext("//attacker.example/path"), null);
  assert.equal(safeLocalNext("https://attacker.example/path"), null);
  assert.equal(safeLocalNext("/\\attacker.example/path"), null);
  assert.equal(safeLocalNext("account"), null);

  const result = await loginOperation(
    {
      email: "player@example.com",
      password: "Password12345!",
      next: "https://attacker.example/path"
    },
    {
      api: client(async () => Response.json(profile)),
      sessionCookieName: "cgn_session",
      applyCookie: () => undefined
    }
  );
  assert.equal(result.status === "success" && result.redirectTo, "/account");
});

test("login input validation accepts typed RPC data and native FormData", () => {
  const native = new FormData();
  native.set("email", " player@example.com ");
  native.set("password", " Password12345! ");
  native.set("next", " /account ");

  assert.deepEqual(validateLoginServerInput(native), {
    valid: true,
    value: {
      email: "player@example.com",
      password: "Password12345!",
      next: "/account"
    }
  });
  assert.equal(
    validateLoginServerInput({
      email: "player@example.com",
      password: "Password12345!"
    }).valid,
    true
  );
});

test("login maps API failures without exposing upstream details", async () => {
  const result = await loginOperation(
    { email: "player@example.com", password: "wrong" },
    {
      api: client(async () =>
        Response.json({ error: "invalid_credentials" }, { status: 401 })
      ),
      sessionCookieName: "cgn_session",
      applyCookie: () => assert.fail("failed login must not write a cookie")
    }
  );

  assert.deepEqual(result, {
    status: "error",
    message: "The email or password did not match."
  });
});

test("logout posts the incoming session and mirrors upstream deletion", async () => {
  let input: string | URL | Request | undefined;
  let init: RequestInit | undefined;
  const mutations: CookieMutation[] = [];
  const result = await logoutOperation({
    api: client(async (requestInput, requestInit) => {
      input = requestInput;
      init = requestInit;
      return new Response(null, {
        status: 204,
        headers: {
          "set-cookie": "cgn_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=-1"
        }
      });
    }),
    cookieHeader: "cgn_session=private-session-value; analytics=value",
    sessionCookieName: "cgn_session",
    applyCookie: (mutation) => mutations.push(mutation)
  });

  assert.equal(input, "http://api:8080/auth/logout");
  assert.equal(init?.method, "POST");
  assert.equal(
    new Headers(init?.headers).get("cookie"),
    "cgn_session=private-session-value; analytics=value"
  );
  assert.deepEqual(mutations, [
    { kind: "delete", name: "cgn_session", options: { path: "/" } }
  ]);
  assert.deepEqual(result, { status: "success", redirectTo: "/" });
  assert.equal(JSON.stringify(result).includes("private-session-value"), false);
});

test("logout failure always deletes the configured local cookie without leaking details", async () => {
  const failures: Fetcher[] = [
    async () => {
      throw new Error("session=private-session-value upstream unavailable");
    },
    async () => Response.json({ error: "private-auth-detail" }, { status: 500 }),
    async () => Response.json({ unexpected: "private-session-value" })
  ];

  const outcomes = await Promise.all(failures.map(async (fetcher) => {
    const mutations: CookieMutation[] = [];
    const result = await logoutOperation({
      api: client(fetcher),
      cookieHeader: "cgn_session=private-session-value",
      sessionCookieName: "custom_session",
      applyCookie: (mutation) => mutations.push(mutation),
      reportError: () => undefined
    });

    return { mutations, result };
  }));

  for (const { mutations, result } of outcomes) {
    assert.deepEqual(mutations, [
      { kind: "delete", name: "custom_session", options: { path: "/" } }
    ]);
    assert.deepEqual(result, { status: "success", redirectTo: "/" });
    assert.equal(JSON.stringify(result).includes("private-session-value"), false);
  }
});

test("logout ignores an unrelated upstream Set-Cookie", async () => {
  const mutations: CookieMutation[] = [];
  const result = await logoutOperation({
    api: client(async () =>
      new Response(null, {
        status: 204,
        headers: { "set-cookie": "other_cookie=; Path=/; Max-Age=-1" }
      })
    ),
    cookieHeader: "cgn_session=value",
    sessionCookieName: "cgn_session",
    applyCookie: (mutation) => mutations.push(mutation)
  });

  assert.deepEqual(mutations, [
    { kind: "delete", name: "cgn_session", options: { path: "/" } }
  ]);
  assert.deepEqual(result, { status: "success", redirectTo: "/" });
});

test("logout deletes the local root session when 204 omits Set-Cookie", async () => {
  const mutations: CookieMutation[] = [];
  const result = await logoutOperation({
    api: client(async () => new Response(null, { status: 204 })),
    cookieHeader: "cgn_session=value",
    sessionCookieName: "cgn_session",
    applyCookie: (mutation) => mutations.push(mutation)
  });

  assert.deepEqual(mutations, [
    { kind: "delete", name: "cgn_session", options: { path: "/" } }
  ]);
  assert.deepEqual(result, { status: "success", redirectTo: "/" });
});
