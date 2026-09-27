import assert from "node:assert/strict";
import test from "node:test";
import { newIdempotencyKey } from "../src/components/idempotency-key.js";
import {
  validateCreateEventServerInput,
  validateReportEventServerInput,
} from "../src/features/event-slice/contracts.js";
import {
  createEventOperation,
  reportEventOperation,
} from "../src/features/event-slice/event-operations.server.js";
import { validateReportUserServerInput } from "../src/features/public-profile/contracts.js";
import { reportUserOperation } from "../src/features/public-profile/public-profile-operations.server.js";
import { validateSupportTicketServerInput } from "../src/features/support-slice/contracts.js";
import { submitSupportTicketOperation } from "../src/features/support-slice/support-operations.server.js";
import { validateCreateTeamServerInput } from "../src/features/team-slice/contracts.js";
import { createTeamOperation } from "../src/features/team-slice/team-operations.server.js";
import { createApiClient, type ApiClient } from "../src/server/api.server.js";

type Validation =
  | { valid: true }
  | { valid: false; fieldErrors: Record<string, string[] | undefined> };

type CreateFlow = {
  name: string;
  path: string;
  fields: Record<string, string>;
  submit: (form: FormData, api: ApiClient) => Promise<Validation>;
};

const quiet = { cookieHeader: "cgn_session=value", reportError: () => {} };

const createFlows: CreateFlow[] = [
  {
    name: "event",
    path: "/events",
    fields: {
      title: "Campus tournament",
      host_school_id: "school-1",
      game_ids: "game-1",
      visibility: "public",
      format: "in_person",
      starts_at: "2037-02-19T21:00",
      ends_at: "2037-02-20T00:00",
      timezone: "America/New_York",
      location_name: "Student Union",
      recurrence_rule: "",
    },
    async submit(form, api) {
      const input = validateCreateEventServerInput(form);
      if (input.valid)
        await createEventOperation(input.value, { api, ...quiet });
      return input;
    },
  },
  {
    name: "team",
    path: "/teams",
    fields: {
      name: "Varsity Rocket League",
      school_id: "school-1",
      game_ids: "game-1",
      password: "TeamPass8",
    },
    async submit(form, api) {
      const input = validateCreateTeamServerInput(form);
      if (input.valid) {
        await createTeamOperation(input.value, {
          api,
          sessionCookieValue: "value",
          ...quiet,
        });
      }
      return input;
    },
  },
  {
    name: "event report",
    path: "/events/campus-tournament/report",
    fields: { slug: "campus-tournament", reason: "Spam listing" },
    async submit(form, api) {
      const input = validateReportEventServerInput(form);
      if (input.valid)
        await reportEventOperation(input.value, { api, ...quiet });
      return input;
    },
  },
  {
    name: "user report",
    path: "/users/user-2/report",
    fields: { user_id: "user-2", reason: "Harassment" },
    async submit(form, api) {
      const input = validateReportUserServerInput(form);
      if (input.valid)
        await reportUserOperation(input.value, { api, ...quiet });
      return input;
    },
  },
  {
    name: "support ticket",
    path: "/support-tickets",
    fields: {
      contact_email: "player@example.test",
      subject: "Need help",
      message: "Please help with my account.",
    },
    async submit(form, api) {
      const input = validateSupportTicketServerInput(form);
      if (input.valid) {
        await submitSupportTicketOperation(input.value, { api, ...quiet });
      }
      return input;
    },
  },
];

function recordingApi() {
  const requests: Array<{
    path: string;
    idempotencyKey: string | null;
    bodyHasKey: boolean;
  }> = [];
  const api = createApiClient({
    baseUrl: "http://api:8080",
    fetcher: async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === "/me") {
        return Response.json({
          id: "viewer-1",
          email: "viewer@example.test",
          verification_level: "verified_student",
          name: "Viewer",
          timezone: "America/Los_Angeles",
          home_school_id: "school-1",
        });
      }
      requests.push({
        path,
        idempotencyKey: new Headers(init?.headers).get("idempotency-key"),
        bodyHasKey: "idempotency_key" in JSON.parse(String(init?.body)),
      });
      return Response.json({ id: "record-1" }, { status: 201 });
    },
  });
  return { api, requests };
}

function formWith(fields: Record<string, string>): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return form;
}

test("create forms send their idempotency key as a header, never in the body", async () => {
  await Promise.all(
    createFlows.map(async (flow) => {
      const key = newIdempotencyKey();
      const { api, requests } = recordingApi();

      const input = await flow.submit(
        formWith({ ...flow.fields, idempotency_key: key }),
        api,
      );

      assert.equal(input.valid, true, flow.name);
      assert.deepEqual(
        requests,
        [{ path: flow.path, idempotencyKey: key, bodyHasKey: false }],
        flow.name,
      );
    }),
  );
});

test("create forms reject a missing or malformed key before calling the API", async () => {
  const keyFields: Array<Record<string, string>> = [
    {},
    { idempotency_key: "retry-1" },
  ];
  await Promise.all(
    keyFields.flatMap((keyField) =>
      createFlows.map(async (flow) => {
        const { api, requests } = recordingApi();

        const input = await flow.submit(
          formWith({ ...flow.fields, ...keyField }),
          api,
        );

        assert.equal(input.valid, false, flow.name);
        if (input.valid) return;
        assert.deepEqual(
          input.fieldErrors.idempotency_key,
          ["Reload the page and try again."],
          flow.name,
        );
        assert.deepEqual(requests, [], flow.name);
      }),
    ),
  );
});
