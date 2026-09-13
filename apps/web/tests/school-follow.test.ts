import assert from "node:assert/strict";
import test from "node:test";
import {
  schoolFollowInputSchema,
  validateSchoolFollowServerInput
} from "../src/features/school-slice/contracts.js";
import {
  followSchoolOperation,
  schoolFollowErrorDestination,
  unfollowSchoolOperation
} from "../src/features/school-slice/school-follow-operations.server.js";
import {
  ApiContractError,
  ApiError,
  createApiClient,
  type Fetcher
} from "../src/server/api.server.js";

function client(fetcher: Fetcher) {
  return createApiClient({ baseUrl: "http://api:8080", fetcher });
}

test("school follow validation trims and allowlists typed and native input", () => {
  const form = new FormData();
  form.set("school_id", " school-1 ");
  form.set("slug", " example-university ");
  form.set("cookieHeader", "must-not-be-accepted");
  form.set("user_id", "must-not-be-accepted");

  assert.deepEqual(validateSchoolFollowServerInput(form), {
    valid: true,
    value: {
      school_id: "school-1",
      slug: "example-university"
    }
  });
  assert.deepEqual(
    validateSchoolFollowServerInput({
      school_id: " school-2 ",
      slug: " second-school "
    }),
    {
      valid: true,
      value: { school_id: "school-2", slug: "second-school" }
    }
  );
  assert.equal(
    schoolFollowInputSchema.safeParse({
      school_id: "school-1",
      slug: "example-university",
      session: "forged"
    }).success,
    false
  );
  assert.deepEqual(
    validateSchoolFollowServerInput({
      school_id: "school-1",
      slug: "example-university",
      session: "forged"
    } as never),
    { valid: false, slug: "example-university" }
  );
  assert.deepEqual(
    validateSchoolFollowServerInput({ school_id: "", slug: "known-school" }),
    { valid: false, slug: "known-school" }
  );
  assert.deepEqual(
    validateSchoolFollowServerInput({
      school_id: "school-1",
      slug: "x".repeat(201)
    }),
    { valid: false }
  );
});

test("follow and unfollow use exact Go endpoints with server-derived cookies", async () => {
  const calls: Array<{
    body: BodyInit | null | undefined;
    cache: RequestCache | undefined;
    cookie: string | null;
    method: string | undefined;
    url: string;
  }> = [];
  const api = client(async (input, init) => {
    calls.push({
      body: init?.body,
      cache: init?.cache,
      cookie: new Headers(init?.headers).get("cookie"),
      method: init?.method,
      url: String(input)
    });
    return new Response(null, { status: 204 });
  });
  const dependencies = {
    api,
    cookieHeader: "cgn_session=server-only; analytics=value"
  };

  const followed = await followSchoolOperation(
    { school_id: "school/id", slug: "example/university" },
    dependencies
  );
  const unfollowed = await unfollowSchoolOperation(
    { school_id: "school/id", slug: "example/university" },
    dependencies
  );

  assert.deepEqual(calls, [
    {
      body: undefined,
      cache: "no-store",
      cookie: "cgn_session=server-only; analytics=value",
      method: "POST",
      url: "http://api:8080/schools/school%2Fid/follow"
    },
    {
      body: undefined,
      cache: "no-store",
      cookie: "cgn_session=server-only; analytics=value",
      method: "DELETE",
      url: "http://api:8080/schools/school%2Fid/follow"
    }
  ]);
  assert.deepEqual(followed, {
    status: "success",
    redirectTo: "/schools/example%2Funiversity?follow=added"
  });
  assert.deepEqual(unfollowed, {
    status: "success",
    redirectTo: "/schools/example%2Funiversity?follow=removed"
  });
  assert.equal(JSON.stringify(followed).includes("server-only"), false);
});

test("Go authentication and API failures map to bounded redirect-only results", async () => {
  const reports: unknown[] = [];
  const unauthorized = await followSchoolOperation(
    { school_id: "school-1", slug: "example-university" },
    {
      api: client(async () =>
        Response.json(
          { error: "authentication_required", detail: "private" },
          { status: 401 }
        )
      ),
      cookieHeader: "",
      reportError: (error) => reports.push(error)
    }
  );
  const unavailable = await unfollowSchoolOperation(
    { school_id: "school-1", slug: "example/university" },
    {
      api: client(async () =>
        Response.json(
          { error: "unfollow_failed", database: "private" },
          { status: 500 }
        )
      ),
      cookieHeader: "cgn_session=value",
      reportError: (error) => reports.push(error)
    }
  );
  const malformed = await followSchoolOperation(
    { school_id: "school-1", slug: "example-university" },
    {
      api: client(async () => Response.json({ internal: "private" })),
      cookieHeader: "cgn_session=value",
      reportError: (error) => reports.push(error)
    }
  );

  assert.deepEqual(unauthorized, {
    status: "success",
    redirectTo: "/login?next=%2Fschools%2Fexample-university"
  });
  assert.deepEqual(unavailable, {
    status: "success",
    redirectTo: "/schools/example%2Funiversity?follow=failed"
  });
  assert.deepEqual(malformed, {
    status: "success",
    redirectTo: "/schools/example-university?follow=failed"
  });
  assert.equal(reports.length, 3);
  assert.ok(reports[0] instanceof ApiError);
  assert.ok(reports[2] instanceof ApiContractError);
  const serialized = JSON.stringify({ unauthorized, unavailable, malformed });
  assert.equal(serialized.includes("private"), false);
});

test("authentication return targets remain local and encoded", () => {
  assert.equal(
    schoolFollowErrorDestination(
      new ApiError(401, "authentication_required"),
      "school/branch"
    ),
    "/login?next=%2Fschools%2Fschool%252Fbranch"
  );
  assert.equal(
    schoolFollowErrorDestination(new Error("private"), "school/branch"),
    "/schools/school%2Fbranch?follow=failed"
  );
});
