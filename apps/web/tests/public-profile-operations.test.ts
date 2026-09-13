import assert from "node:assert/strict";
import test from "node:test";
import { createApiClient, type Fetcher } from "../src/server/api.server.js";
import {
  publicProfileDtoSchema,
  reportUserNativeDestination,
  validatePublicProfileSearch,
  validateReportUserServerInput
} from "../src/features/public-profile/contracts.js";
import {
  getPublicProfilePageOperation,
  reportUserOperation
} from "../src/features/public-profile/public-profile-operations.server.js";
import {
  publicProfileHomeSchool,
  publicProfileMetadata,
  roleIndicatorLabel,
  safeHTTPURL,
  userInitials,
  verificationLabel
} from "../src/features/public-profile/presentation.js";

const publicProfile = {
  id: "user/e2e",
  name: "Player One",
  avatar_url: "https://images.example/player.png",
  bio: "Campus competitor",
  verification_level: "verified",
  home_school_id: "school-1",
  home_school: {
    id: "school-1",
    name: "Example University",
    slug: "example-university",
    city: "Irvine",
    state: "CA"
  },
  social_links: [
    { id: "social-1", label: "Streaming", url: "https://example.test/player" }
  ],
  role_indicators: ["school_admin"],
  email: "private@example.test",
  session: "must-not-serialize",
  unlock_token: "must-not-serialize",
  "X-CGN-Visitor-IP": "must-not-serialize"
};

const viewerProfile = {
  id: "viewer-private-id",
  email: "viewer-private@example.test",
  verification_level: "basic",
  name: "Private Viewer",
  timezone: "America/Los_Angeles",
  home_school_id: "school-2"
};

function client(fetcher: Fetcher) {
  return createApiClient({ baseUrl: "http://api:8080", fetcher });
}

test("public profile is a no-store public allowlist and skips /me without the configured session", async () => {
  const calls: Array<{ init?: RequestInit; url: string }> = [];
  const result = await getPublicProfilePageOperation(
    { id: "user/e2e" },
    {
      api: client(async (input, init) => {
        calls.push({ init, url: String(input) });
        return Response.json(publicProfile);
      }),
      cookieHeader: "unrelated=present"
    }
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "http://api:8080/users/user%2Fe2e");
  assert.equal(calls[0]?.init?.cache, "no-store");
  assert.equal(new Headers(calls[0]?.init?.headers).has("cookie"), false);
  assert.deepEqual(result, {
    status: "found",
    profile: {
      id: "user/e2e",
      name: "Player One",
      avatar_url: "https://images.example/player.png",
      bio: "Campus competitor",
      verification_level: "verified",
      home_school_id: "school-1",
      home_school: {
        id: "school-1",
        name: "Example University",
        slug: "example-university",
        city: "Irvine",
        state: "CA"
      },
      social_links: [
        {
          id: "social-1",
          label: "Streaming",
          url: "https://example.test/player"
        }
      ],
      role_indicators: ["school_admin"]
    },
    viewer: "anonymous"
  });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("private@example.test"), false);
  assert.equal(serialized.includes("must-not-serialize"), false);
  assert.equal(serialized.includes("X-CGN-Visitor-IP"), false);
});

test("viewer lookup forwards only server-side cookie state and serializes only the relationship", async () => {
  const calls: Array<{ init?: RequestInit; url: string }> = [];
  const result = await getPublicProfilePageOperation(
    { id: "user/e2e" },
    {
      api: client(async (input, init) => {
        calls.push({ init, url: String(input) });
        return Response.json(
          String(input).endsWith("/me") ? viewerProfile : publicProfile
        );
      }),
      cookieHeader: "cgn_session=server-only-value; unrelated=present",
      sessionCookieValue: "server-only-value"
    }
  );

  assert.equal(calls.length, 2);
  assert.equal(calls[1]?.url, "http://api:8080/me");
  assert.equal(calls[1]?.init?.cache, "no-store");
  assert.equal(
    new Headers(calls[1]?.init?.headers).get("cookie"),
    "cgn_session=server-only-value; unrelated=present"
  );
  assert.equal(result.status, "found");
  if (result.status !== "found") {
    assert.fail("profile should be found");
  }
  assert.equal(result.viewer, "other");
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("viewer-private-id"), false);
  assert.equal(serialized.includes("viewer-private@example.test"), false);
  assert.equal(serialized.includes("server-only-value"), false);
});

test("viewer relationship identifies self without serializing a second profile", async () => {
  const result = await getPublicProfilePageOperation(
    { id: "user/e2e" },
    {
      api: client(async (input) =>
        Response.json(
          String(input).endsWith("/me")
            ? { ...viewerProfile, id: "user/e2e" }
            : publicProfile
        )
      ),
      cookieHeader: "cgn_session=value",
      sessionCookieValue: "value"
    }
  );

  assert.equal(result.status, "found");
  if (result.status !== "found") {
    assert.fail("profile should be found");
  }
  assert.equal(result.viewer, "self");
  assert.equal(JSON.stringify(result).includes("viewer-private@example.test"), false);
});

test("an upstream 401 is the only viewer failure treated as anonymous", async () => {
  const result = await getPublicProfilePageOperation(
    { id: "user/e2e" },
    {
      api: client(async (input) =>
        String(input).endsWith("/me")
          ? Response.json(
              { error: "authentication_required" },
              { status: 401 }
            )
          : Response.json(publicProfile)
      ),
      cookieHeader: "cgn_session=expired",
      sessionCookieValue: "expired"
    }
  );

  assert.equal(result.status, "found");
  if (result.status !== "found") {
    assert.fail("profile should be found");
  }
  assert.equal(result.viewer, "anonymous");
});

test("an exact target 404 remains not-found and does not call /me", async () => {
  let calls = 0;
  const result = await getPublicProfilePageOperation(
    { id: "missing" },
    {
      api: client(async () => {
        calls += 1;
        return Response.json({ error: "user_not_found" }, { status: 404 });
      }),
      cookieHeader: "cgn_session=value",
      sessionCookieValue: "value"
    }
  );

  assert.deepEqual(result, { status: "not_found" });
  assert.equal(calls, 1);
});

test("viewer outages and response-contract failures are generic errors, never anonymous", async () => {
  const reported: unknown[] = [];
  const outage = await getPublicProfilePageOperation(
    { id: "user/e2e" },
    {
      api: client(async (input) =>
        String(input).endsWith("/me")
          ? Response.json(
              { error: "sensitive_upstream_detail" },
              { status: 503 }
            )
          : Response.json(publicProfile)
      ),
      cookieHeader: "cgn_session=value",
      sessionCookieValue: "value",
      reportError: (error) => reported.push(error)
    }
  );
  const contractFailure = await getPublicProfilePageOperation(
    { id: "user/e2e" },
    {
      api: client(async () => Response.json({ id: "user/e2e" })),
      cookieHeader: "",
      reportError: (error) => reported.push(error)
    }
  );

  const safeFailure = {
    status: "error",
    message: "We could not load this profile. Please try again."
  };
  assert.deepEqual(outage, safeFailure);
  assert.deepEqual(contractFailure, safeFailure);
  assert.equal(JSON.stringify(outage).includes("sensitive_upstream_detail"), false);
  assert.equal(reported.length, 2);
});

test("public profile presentation keeps metadata and outbound URLs safe", () => {
  const profile = publicProfileDtoSchema.parse({
    ...publicProfile,
    bio: "   ",
    email: "private@example.test"
  });
  const metadata = publicProfileMetadata(profile, "https://cgn.example");

  assert.deepEqual(metadata, {
    title: "Player One | Campus Gaming Network",
    description:
      "Player One plays at Example University on Campus Gaming Network.",
    url: "https://cgn.example/users/user%2Fe2e"
  });
  assert.equal(JSON.stringify(metadata).includes("private@example.test"), false);
  assert.deepEqual(publicProfileHomeSchool(profile), {
    name: "Example University",
    location: "Irvine, CA",
    href: "/schools/example-university"
  });
  assert.equal(verificationLabel("verified"), "Verified student");
  assert.equal(roleIndicatorLabel("school_admin"), "School admin");
  assert.equal(userInitials("Player One"), "PO");
  assert.equal(safeHTTPURL("javascript:alert(1)"), undefined);
  assert.equal(safeHTTPURL("data:text/html,unsafe"), undefined);
  assert.equal(safeHTTPURL("https://example.test/player"), "https://example.test/player");
});

test("report-user validation trims allowed fields and rejects missing or oversized input", () => {
  const form = new FormData();
  form.set("user_id", " user/e2e ");
  form.set("reason", " Harassing other players. ");
  form.set("cookieHeader", "browser-controlled-session");

  assert.deepEqual(validateReportUserServerInput(form), {
    valid: true,
    value: {
      userID: "user/e2e",
      reason: "Harassing other players."
    }
  });

  form.set("reason", "   ");
  const missingReason = validateReportUserServerInput(form);
  assert.equal(missingReason.valid, false);
  if (missingReason.valid) assert.fail("an empty reason was accepted");
  assert.deepEqual(missingReason.fieldErrors.reason, ["Reason is required."]);
  assert.equal(missingReason.userID, "user/e2e");

  form.set("user_id", "x".repeat(201));
  form.set("reason", "valid reason");
  const oversizedTarget = validateReportUserServerInput(form);
  assert.equal(oversizedTarget.valid, false);
  if (oversizedTarget.valid) assert.fail("an oversized target was accepted");
  assert.deepEqual(oversizedTarget.fieldErrors.userID, [
    "User must be 200 characters or fewer."
  ]);
  assert.equal(oversizedTarget.userID, undefined);
});

test("report-user native destinations and notices stay on bounded local routes", () => {
  assert.equal(
    reportUserNativeDestination("user/e2e", "submitted"),
    "/users/user%2Fe2e?report=submitted"
  );
  assert.equal(
    reportUserNativeDestination("https://attacker.test/path", "failed"),
    "/users/https%3A%2F%2Fattacker.test%2Fpath?report=failed"
  );
  assert.equal(reportUserNativeDestination(undefined, "failed"), "/");
  assert.deepEqual(validatePublicProfileSearch({ report: "submitted" }), {
    report: "submitted"
  });
  assert.deepEqual(
    validatePublicProfileSearch({ report: ["failed", "submitted"] }),
    { report: "failed" }
  );
  assert.deepEqual(
    validatePublicProfileSearch({ report: "https://attacker.test" }),
    {}
  );
});

test("report-user mutation encodes its target and forwards only server-derived auth", async () => {
  let request:
    | { body: unknown; cookie: string | null; method?: string; url: string }
    | undefined;
  const result = await reportUserOperation(
    { userID: "user/e2e", reason: "Harassing other players." },
    {
      api: client(async (input, init) => {
        request = {
          body: JSON.parse(String(init?.body)),
          cookie: new Headers(init?.headers).get("cookie"),
          method: init?.method,
          url: String(input)
        };
        return Response.json({
          id: "report-1",
          reason: "must-not-serialize",
          session: "must-not-serialize"
        });
      }),
      cookieHeader: "cgn_session=server-only-value; analytics=present"
    }
  );

  assert.deepEqual(request, {
    body: { reason: "Harassing other players." },
    cookie: "cgn_session=server-only-value; analytics=present",
    method: "POST",
    url: "http://api:8080/users/user%2Fe2e/report"
  });
  assert.deepEqual(result, {
    status: "success",
    message: "Report submitted for review."
  });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("Harassing other players"), false);
  assert.equal(serialized.includes("server-only-value"), false);
});

test("report-user mutation leaves auth enforcement at the API and returns safe errors", async () => {
  const reported: unknown[] = [];
  const unauthorized = await reportUserOperation(
    { userID: "target-user", reason: "Spam" },
    {
      api: client(async () =>
        Response.json(
          { error: "authentication_required", detail: "private-auth-detail" },
          { status: 401 }
        )
      ),
      cookieHeader: "",
      reportError: (error) => reported.push(error)
    }
  );
  const malformedSuccess = await reportUserOperation(
    { userID: "target-user", reason: "Spam" },
    {
      api: client(async () =>
        Response.json({ id: "", database_detail: "private-contract-detail" })
      ),
      cookieHeader: "cgn_session=server-only-value",
      reportError: (error) => reported.push(error)
    }
  );

  assert.deepEqual(unauthorized, {
    status: "error",
    message: "Please log in to continue."
  });
  assert.deepEqual(malformedSuccess, {
    status: "error",
    message: "Something went wrong. Please try again."
  });
  const serialized = JSON.stringify({ unauthorized, malformedSuccess });
  assert.equal(serialized.includes("private-auth-detail"), false);
  assert.equal(serialized.includes("private-contract-detail"), false);
  assert.equal(serialized.includes("Spam"), false);
  assert.equal(reported.length, 2);
});
