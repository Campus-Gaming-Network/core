import assert from "node:assert/strict";
import test from "node:test";
import {
  validateCreateEventServerInput,
  validateEventInterestServerInput,
  validateNewEventSearch,
  validateReportEventServerInput,
  validateUpdateEventServerInput,
  type EventMutationPayload
} from "../src/features/event-slice/contracts.js";
import {
  cancelEventOperation,
  createEventOperation,
  editEventPageOperation,
  eventInterestOperation,
  newEventPageOperation,
  reportEventOperation,
  updateEventOperation
} from "../src/features/event-slice/event-operations.server.js";
import { createApiClient, type Fetcher } from "../src/server/api.server.js";

const school = {
  id: "school-1",
  name: "Example University",
  slug: "example-university",
  city: "Irvine",
  state: "CA"
};
const game = { id: "game-1", name: "Example Game", slug: "example-game" };
const event = {
  id: "event-1",
  title: "Campus tournament",
  slug: "campus-tournament",
  description: "Bring your controller.",
  visibility: "public" as const,
  format: "in_person" as const,
  starts_at: "2037-02-20T02:00:00.000Z",
  ends_at: "2037-02-20T05:00:00.000Z",
  timezone: "America/Los_Angeles",
  location_name: "Student Union",
  capacity: 32,
  rsvp_yes_count: 2,
  interest_count: 4,
  lifecycle: "upcoming" as const,
  is_paid: false,
  host_school: school,
  games: [game],
  viewer_can_edit: true
};

function client(fetcher: Fetcher) {
  return createApiClient({ baseUrl: "http://api:8080", fetcher });
}

function validEventForm(): FormData {
  const form = new FormData();
  form.set("title", "  Campus tournament  ");
  form.set("description", " Bring your controller. ");
  form.set("host_school_id", school.id);
  form.append("game_ids", ` ${game.id} `);
  form.set("visibility", "public");
  form.set("format", "in_person");
  form.set("starts_at", "2037-02-19T21:00");
  form.set("ends_at", "2037-02-20T00:00");
  form.set("timezone", "America/New_York");
  form.set("location_name", "Student Union");
  form.set("address", "");
  form.set("online_url", "");
  form.set("private_password", "");
  form.set("capacity", "32");
  form.set("is_paid", "on");
  form.set("payment_note", "");
  form.set("payment_url", "");
  return form;
}

test("event create validation normalizes payloads, local times, and recurrence", () => {
  const form = validEventForm();
  form.set("recurrence_rule", "weekly");
  form.set("recurrence_until", "2037-03-19");
  const result = validateCreateEventServerInput(form);

  assert.equal(result.valid, true);
  if (!result.valid) assert.fail("valid event was rejected");
  assert.deepEqual(result.value, {
    title: "Campus tournament",
    description: "Bring your controller.",
    host_school_id: school.id,
    game_ids: [game.id],
    visibility: "public",
    format: "in_person",
    starts_at: "2037-02-20T02:00:00.000Z",
    ends_at: "2037-02-20T05:00:00.000Z",
    timezone: "America/New_York",
    location_name: "Student Union",
    address: "",
    online_url: "",
    private_password: "",
    capacity: 32,
    is_paid: true,
    payment_note: "",
    payment_url: "",
    recurrence_rule: "weekly",
    recurrence_until: "2037-03-19"
  });
});

test("event update rejects recurrence fields and create enforces relationships and DST", () => {
  const update = validEventForm();
  update.set("slug", " campus/tournament ");
  const validUpdate = validateUpdateEventServerInput(update);
  assert.equal(validUpdate.valid, true);
  if (!validUpdate.valid) assert.fail("valid update was rejected");
  assert.equal(validUpdate.value.slug, "campus/tournament");
  assert.equal("recurrence_rule" in validUpdate.value, false);
  assert.equal("recurrence_until" in validUpdate.value, false);

  update.set("recurrence_rule", "weekly");
  const immutable = validateUpdateEventServerInput(update);
  assert.equal(immutable.valid, false);
  if (immutable.valid) assert.fail("recurrence mutation was accepted");
  assert.deepEqual(immutable.fieldErrors.recurrence_rule, [
    "Recurrence settings cannot be changed after an event is created."
  ]);

  const missingEnd = validEventForm();
  missingEnd.set("recurrence_rule", "weekly");
  const recurrence = validateCreateEventServerInput(missingEnd);
  assert.equal(recurrence.valid, false);
  if (recurrence.valid) assert.fail("incomplete recurrence was accepted");
  assert.deepEqual(recurrence.fieldErrors.recurrence_until, [
    "Choose when the recurrence ends."
  ]);

  const gap = validEventForm();
  gap.set("starts_at", "2026-03-08T02:30");
  gap.set("ends_at", "2026-03-08T04:00");
  gap.set("timezone", "America/Los_Angeles");
  gap.set("recurrence_rule", "");
  const invalidGap = validateCreateEventServerInput(gap);
  assert.equal(invalidGap.valid, false);
  if (invalidGap.valid) assert.fail("DST gap was accepted");
  assert.deepEqual(invalidGap.fieldErrors.starts_at, [
    "Start time does not exist because clocks move forward. Choose another time."
  ]);
});

test("private password, reports, interest, and search use strict field validation", () => {
  const privateForm = validEventForm();
  privateForm.set("visibility", "private");
  privateForm.set("recurrence_rule", "");
  const privateEvent = validateCreateEventServerInput(privateForm);
  assert.equal(privateEvent.valid, false);
  if (privateEvent.valid) assert.fail("passwordless private event was accepted");
  assert.deepEqual(privateEvent.fieldErrors.private_password, [
    "Private events require a password of at least 8 characters."
  ]);

  const report = new FormData();
  report.set("slug", " event/one ");
  report.set("reason", "   ");
  const invalidReport = validateReportEventServerInput(report);
  assert.equal(invalidReport.valid, false);
  if (invalidReport.valid) assert.fail("empty report was accepted");
  assert.deepEqual(invalidReport.fieldErrors.reason, ["Reason is required."]);

  const interest = new FormData();
  interest.set("slug", "event/one");
  interest.set("interested", "sometimes");
  assert.equal(validateEventInterestServerInput(interest).valid, false);
  assert.deepEqual(
    validateEventInterestServerInput({ slug: " event/one ", interested: true }),
    { valid: true, value: { slug: "event/one", interested: true } }
  );

  assert.deepEqual(
    validateNewEventSearch({
      school_q: [" Example ", "ignored"],
      event: "failed"
    }),
    { school_q: "Example", event: "failed" }
  );
  assert.deepEqual(validateNewEventSearch({ school_q: "x".repeat(121) }), {});
});

test("new-event page data enforces auth then loads default profile and catalogs", async () => {
  let anonymousCalls = 0;
  const anonymous = await newEventPageOperation(
    { schoolQuery: "" },
    {
      api: client(async () => {
        anonymousCalls += 1;
        return Response.json({});
      }),
      cookieHeader: "analytics=value"
    }
  );
  assert.deepEqual(anonymous, { status: "unauthenticated" });
  assert.equal(anonymousCalls, 0);

  const calls: Array<{ path: string; cookie: string | null }> = [];
  const ready = await newEventPageOperation(
    { schoolQuery: " Example " },
    {
      api: client(async (input, init) => {
        const path = new URL(String(input)).pathname + new URL(String(input)).search;
        calls.push({ path, cookie: new Headers(init?.headers).get("cookie") });
        if (path === "/me") {
          return Response.json({
            email: "private@example.test",
            home_school_id: school.id,
            home_school: { ...school, private_note: "strip" },
            timezone: "America/New_York",
            session: "strip"
          });
        }
        if (path === "/games") {
          return Response.json({ games: [{ ...game, internal_rank: 1 }] });
        }
        return Response.json({
          schools: [{ ...school, internal_note: "strip" }],
          limit: 50,
          offset: 0,
          has_more: false
        });
      }),
      cookieHeader: "cgn_session=session-value",
      sessionCookieValue: "session-value"
    }
  );

  assert.equal(ready.status, "ready");
  if (ready.status !== "ready") assert.fail("new event page did not load");
  assert.equal(ready.defaultSchoolID, school.id);
  assert.equal(ready.defaultTimeZone, "America/New_York");
  assert.deepEqual(ready.defaultSchool, school);
  assert.deepEqual(ready.games, [game]);
  assert.deepEqual(ready.schools, [school]);
  assert.equal(JSON.stringify(ready).includes("private@example.test"), false);
  assert.equal(JSON.stringify(ready).includes("internal"), false);
  assert.deepEqual(calls[0], {
    path: "/me",
    cookie: "cgn_session=session-value"
  });
  assert.deepEqual(
    Object.fromEntries(calls.slice(1).map(({ path, cookie }) => [path, cookie])),
    {
      "/games": null,
      "/schools?q=Example&limit=50": null
    }
  );
});

test("new-event catalogs keep school failure inline and make game failure fatal", async () => {
  const reported: unknown[] = [];
  const schoolFailure = await newEventPageOperation(
    { schoolQuery: "Example" },
    {
      api: client(async (input) => {
        const path = new URL(String(input)).pathname;
        if (path === "/me") {
          return Response.json({
            home_school_id: school.id,
            timezone: "America/Los_Angeles"
          });
        }
        if (path === "/games") return Response.json({ games: [game] });
        return Response.json({ error: "private_database_error" }, { status: 503 });
      }),
      cookieHeader: "cgn_session=value",
      sessionCookieValue: "value",
      reportError: (error) => reported.push(error)
    }
  );
  assert.equal(schoolFailure.status, "ready");
  if (schoolFailure.status !== "ready") assert.fail("school failure was fatal");
  assert.equal(schoolFailure.schoolSearchFailed, true);
  assert.deepEqual(schoolFailure.schools, []);

  const gameFailure = await newEventPageOperation(
    { schoolQuery: "" },
    {
      api: client(async (input) =>
        new URL(String(input)).pathname === "/me"
          ? Response.json({
              home_school_id: school.id,
              timezone: "America/Los_Angeles"
            })
          : Response.json({ error: "private_database_error" }, { status: 503 })
      ),
      cookieHeader: "cgn_session=value",
      sessionCookieValue: "value",
      reportError: (error) => reported.push(error)
    }
  );
  assert.deepEqual(gameFailure, {
    status: "error",
    message: "Event creation is unavailable."
  });
  assert.equal(reported.length, 2);
});

test("edit page distinguishes missing, locked, forbidden, and editable events", async () => {
  async function editWith(detailResponse: Response) {
    const calls: string[] = [];
    const result = await editEventPageOperation(
      { slug: "campus/tournament", schoolQuery: "" },
      {
        api: client(async (input) => {
          const path = new URL(String(input)).pathname;
          calls.push(path);
          if (path === "/me") {
            return Response.json({
              home_school_id: school.id,
              timezone: "America/Los_Angeles"
            });
          }
          if (path === "/games") return Response.json({ games: [game] });
          return detailResponse.clone();
        }),
        cookieHeader: "cgn_session=value",
        sessionCookieValue: "value"
      }
    );
    return { calls, result };
  }

  const missing = await editWith(
    Response.json({ error: "event_not_found" }, { status: 404 })
  );
  assert.deepEqual(missing.result, { status: "not_found" });
  assert.deepEqual(missing.calls, ["/me", "/events/campus%2Ftournament"]);

  const locked = await editWith(
    Response.json({
      slug: "campus/tournament",
      visibility: "private",
      locked: true
    })
  );
  assert.deepEqual(locked.result, { status: "denied", reason: "locked" });
  assert.deepEqual(locked.calls, ["/me", "/events/campus%2Ftournament"]);

  const forbidden = await editWith(Response.json({ ...event, viewer_can_edit: false }));
  assert.deepEqual(forbidden.result, { status: "denied", reason: "forbidden" });
  assert.deepEqual(forbidden.calls, ["/me", "/events/campus%2Ftournament"]);

  const editable = await editWith(Response.json({ ...event, internal_note: "strip" }));
  assert.equal(editable.result.status, "ready");
  if (editable.result.status !== "ready") assert.fail("editor was denied");
  assert.deepEqual(editable.result.event, event);
  assert.deepEqual(editable.calls, [
    "/me",
    "/events/campus%2Ftournament",
    "/games"
  ]);
});

test("event writes forward exact auth, method, payload, and safe returned DTOs", async () => {
  const requests: Array<{ path: string; init?: RequestInit; body: unknown }> = [];
  const api = client(async (input, init) => {
    requests.push({
      path: new URL(String(input)).pathname,
      init,
      body: init?.body ? JSON.parse(String(init.body)) : undefined
    });
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/report")) return Response.json({ id: "report-1" });
    if (init?.method === "DELETE" && !path.endsWith("/interest")) {
      return new Response(null, { status: 204 });
    }
    return Response.json({ ...event, internal_token: "strip" });
  });
  const createForm = validEventForm();
  createForm.set("recurrence_rule", "");
  const createValidated = validateCreateEventServerInput(createForm);
  assert.equal(createValidated.valid, true);
  if (!createValidated.valid) assert.fail("create payload was invalid");
  const payload = createValidated.value;

  const created = await createEventOperation(payload, {
    api,
    cookieHeader: "cgn_session=value"
  });
  const updated = await updateEventOperation(
    { slug: "old/event", ...withoutRecurrence(payload) },
    { api, cookieHeader: "cgn_session=value" }
  );
  const reported = await reportEventOperation(
    { slug: "event/one", reason: "Spam listing" },
    { api, cookieHeader: "cgn_session=value" }
  );
  const interested = await eventInterestOperation(
    { slug: "event/one", interested: true },
    {
      api,
      cookieHeader: "cgn_session=value",
      unlockHeaders: { "X-CGN-Event-Unlock": "unlock-value" }
    }
  );
  const uninterested = await eventInterestOperation(
    { slug: "event/one", interested: false },
    { api, cookieHeader: "cgn_session=value" }
  );
  const cancelled = await cancelEventOperation(
    { slug: "event/one" },
    { api, cookieHeader: "cgn_session=value" }
  );

  assert.equal(created.status, "success");
  if (created.status !== "success") assert.fail("create failed");
  assert.equal(created.redirectTo, "/events/campus-tournament?event=created");
  assert.equal(JSON.stringify(created).includes("internal_token"), false);
  assert.equal(updated.status, "success");
  if (updated.status !== "success") assert.fail("update failed");
  assert.equal(updated.redirectTo, "/events/campus-tournament?event=updated");
  assert.deepEqual(reported, {
    status: "success",
    message: "Report submitted for review."
  });
  assert.deepEqual(interested, {
    redirectTo: "/events/campus-tournament?event=interest-added"
  });
  assert.deepEqual(uninterested, {
    redirectTo: "/events/campus-tournament?event=interest-removed"
  });
  assert.deepEqual(cancelled, { redirectTo: "/events?event=cancelled" });

  assert.deepEqual(
    requests.map(({ path, init }) => ({
      path,
      method: init?.method,
      cookie: new Headers(init?.headers).get("cookie"),
      unlock: new Headers(init?.headers).get("x-cgn-event-unlock")
    })),
    [
      { path: "/events", method: "POST", cookie: "cgn_session=value", unlock: null },
      { path: "/events/old%2Fevent", method: "PATCH", cookie: "cgn_session=value", unlock: null },
      { path: "/events/event%2Fone/report", method: "POST", cookie: "cgn_session=value", unlock: null },
      { path: "/events/event%2Fone/interest", method: "POST", cookie: "cgn_session=value", unlock: "unlock-value" },
      { path: "/events/event%2Fone/interest", method: "DELETE", cookie: "cgn_session=value", unlock: null },
      { path: "/events/event%2Fone", method: "DELETE", cookie: "cgn_session=value", unlock: null }
    ]
  );
  assert.deepEqual(requests[2]?.body, { reason: "Spam listing" });
  assert.ok(requests[1]);
  assert.equal("slug" in (requests[1].body as object), false);
  assert.equal("recurrence_rule" in (requests[1].body as object), false);
});

test("event write failures never expose backend error strings", async () => {
  const api = client(async () =>
    Response.json({ error: "private_database_connection_secret" }, { status: 500 })
  );
  const payload = validPayload();
  const created = await createEventOperation(payload, {
    api,
    cookieHeader: "cgn_session=value",
    reportError: () => undefined
  });
  const report = await reportEventOperation(
    { slug: "event", reason: "Spam" },
    { api, cookieHeader: "cgn_session=value", reportError: () => undefined }
  );
  const interest = await eventInterestOperation(
    { slug: "event", interested: true },
    { api, cookieHeader: "cgn_session=value", reportError: () => undefined }
  );
  const cancel = await cancelEventOperation(
    { slug: "event" },
    { api, cookieHeader: "cgn_session=value", reportError: () => undefined }
  );

  assert.deepEqual(created, {
    status: "error",
    message: "Something went wrong. Please try again."
  });
  assert.deepEqual(report, {
    status: "error",
    message: "Something went wrong. Please try again."
  });
  assert.deepEqual(interest, {
    redirectTo: "/events/event?event=interest-failed"
  });
  assert.deepEqual(cancel, {
    redirectTo: "/events/event?event=cancel-failed"
  });
  assert.equal(JSON.stringify([created, report, interest, cancel]).includes("secret"), false);
});

function withoutRecurrence(payload: EventMutationPayload): EventMutationPayload {
  const { recurrence_rule: _rule, recurrence_until: _until, ...eventPayload } = payload;
  return eventPayload;
}

function validPayload(): EventMutationPayload {
  return {
    title: "Campus tournament",
    description: "Bring your controller.",
    host_school_id: school.id,
    game_ids: [game.id],
    visibility: "public",
    format: "in_person",
    starts_at: "2037-02-20T02:00:00.000Z",
    ends_at: "2037-02-20T05:00:00.000Z",
    timezone: "America/Los_Angeles",
    location_name: "Student Union",
    address: "",
    online_url: "",
    private_password: "",
    capacity: 32,
    is_paid: false,
    payment_note: "",
    payment_url: ""
  };
}
