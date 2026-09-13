import assert from "node:assert/strict";
import test from "node:test";
import {
  ApiContractError,
  ApiError,
  createApiClient,
  type Fetcher
} from "../src/server/api.server.js";
import { cookieHeaderValue } from "../src/server/cookies.server.js";
import {
  isNativeFormRequest,
  sessionRequestForHeaders
} from "../src/server/request-boundary.server.js";
import {
  AuthenticationRequiredError,
  optionalViewerProfile,
  requiredViewerProfile
} from "../src/server/viewer.server.js";

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
    baseUrl: "http://api:8080",
    fetcher
  });
}

test("session boundary extracts only the exact configured incoming cookie", () => {
  const previousName = process.env.API_SESSION_COOKIE;
  process.env.API_SESSION_COOKIE = "custom_session";

  try {
    const request = sessionRequestForHeaders(
      new Headers({
        cookie: "analytics=value; cgn_session=wrong; custom_session=expected"
      })
    );

    assert.equal(request.cookieHeader, "custom_session=expected");
    assert.equal(request.sessionCookieName, "custom_session");
    assert.equal(request.sessionCookieValue, "expected");
    assert.equal(request.cookieHeader.includes("analytics=value"), false);
    assert.equal(request.cookieHeader.includes("cgn_session=wrong"), false);
    assert.equal(cookieHeaderValue(request.cookieHeader, "missing"), undefined);
  } finally {
    if (previousName === undefined) {
      delete process.env.API_SESSION_COOKIE;
    } else {
      process.env.API_SESSION_COOKIE = previousName;
    }
  }
});

test("native form detection excludes enhanced TanStack server function requests", () => {
  assert.equal(
    isNativeFormRequest(new Headers({
      "content-type": "multipart/form-data; boundary=enhanced",
      "x-tsr-serverfn": "true"
    })),
    false
  );
  assert.equal(
    isNativeFormRequest(new Headers({
      "content-type": "application/x-www-form-urlencoded"
    })),
    true
  );
  assert.equal(
    isNativeFormRequest(new Headers({ "content-type": "application/json" })),
    false
  );
});

test("optional viewer skips anonymous traffic and validates its safe profile DTO", async () => {
  let calls = 0;
  const api = client(async () => {
    calls += 1;
    return Response.json({
      ...profile,
      session: "must-not-cross-profile-boundary",
      unlock_token: "must-not-cross-profile-boundary"
    });
  });

  assert.equal(
    await optionalViewerProfile({
      api,
      cookieHeader: "analytics=value",
      sessionCookieValue: undefined
    }),
    null
  );
  const authenticated = await optionalViewerProfile({
    api,
    cookieHeader: "cgn_session=session-value",
    sessionCookieValue: "session-value"
  });

  assert.deepEqual(authenticated, profile);
  assert.equal(calls, 1);
  assert.equal(JSON.stringify(authenticated).includes("must-not-cross"), false);
});

test("optional viewer maps only upstream 401 to anonymous", async () => {
  const anonymous = await optionalViewerProfile({
    api: client(async () =>
      Response.json({ error: "authentication_required" }, { status: 401 })
    ),
    cookieHeader: "cgn_session=expired",
    sessionCookieValue: "expired"
  });

  assert.equal(anonymous, null);
  await assert.rejects(
    () =>
      optionalViewerProfile({
        api: client(async () =>
          Response.json({ error: "database_unavailable" }, { status: 503 })
        ),
        cookieHeader: "cgn_session=value",
        sessionCookieValue: "value"
      }),
    (error: unknown) => error instanceof ApiError && error.status === 503
  );
  await assert.rejects(
    () =>
      optionalViewerProfile({
        api: client(async () => Response.json({ unexpected: true })),
        cookieHeader: "cgn_session=value",
        sessionCookieValue: "value"
      }),
    ApiContractError
  );
});

test("required viewer rejects only an absent or unauthorized session", async () => {
  await assert.rejects(
    () =>
      requiredViewerProfile({
        api: client(async () => assert.fail("anonymous request must not call /me")),
        cookieHeader: "",
        sessionCookieValue: undefined
      }),
    AuthenticationRequiredError
  );

  const authenticated = await requiredViewerProfile({
    api: client(async () => Response.json(profile)),
    cookieHeader: "cgn_session=value",
    sessionCookieValue: "value"
  });
  assert.deepEqual(authenticated, profile);
});
