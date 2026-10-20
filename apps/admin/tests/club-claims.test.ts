import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import {
  validateCatalogCommandInput,
  validateCatalogSearch,
} from "../src/features/catalog/contracts.js";
import {
  listClubClaimsOperation,
  runCatalogCommandOperation,
} from "../src/features/catalog/catalog-operations.server.js";
import { AdminApiError, type ApiClient } from "../src/server/api.server.js";

const claimID = "77777777-7777-4777-8777-777777777777";
const version = "2026-10-20T12:00:00Z";
const mutation = { cookieHeader: "admin", headers: {} };

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

function recordingApi(respond: (path: string) => unknown) {
  const calls: Array<{ path: string; method?: string; body?: unknown }> = [];
  const api = (async (options) => {
    calls.push({
      path: options.path,
      method: options.method,
      body: options.body,
    });
    return { data: respond(options.path), response: Response.json({}) };
  }) as ApiClient;
  return { api, calls };
}

const command = {
  command: "club_claim.approve",
  id: claimID,
  expected_updated_at: version,
  reason: "Officer listed on the university page",
};

test("approving a request needs the new club's name, address, and type together", () => {
  const partial = validateCatalogCommandInput(
    form({ ...command, club_name: "Chess Club" }),
  );
  assert.equal(partial.valid, false);
  assert.deepEqual(partial.valid ? {} : partial.fieldErrors, {
    club_slug: ["Enter the club's page address."],
    club_type: ["Choose the club's type."],
  });

  const claim = validateCatalogCommandInput(form(command));
  const request = validateCatalogCommandInput(
    form({
      ...command,
      club_name: "Chess Club",
      club_slug: "chess-club-fixture-u",
      club_type: "student_club",
    }),
  );
  assert.deepEqual(
    [claim.valid, request.valid && request.value.club_slug],
    [true, "chess-club-fixture-u"],
  );
});

test("approve and reject call their named operations and return to the claim", async () => {
  const sent = await Promise.all(
    [
      { ...command, club_name: "", club_slug: "", club_type: "" },
      {
        ...command,
        club_name: "Chess Club",
        club_slug: "chess-club-fixture-u",
        club_type: "student_club",
      },
      { ...command, command: "club_claim.reject", reason: "No evidence" },
    ].map(async (fields) => {
      const validated = validateCatalogCommandInput(form(fields));
      assert.ok(validated.valid);
      const { api, calls } = recordingApi(() => ({ id: claimID }));
      const result = await runCatalogCommandOperation(validated.value, {
        api,
        ...mutation,
      });
      return { result, call: calls[0] };
    }),
  );
  assert.deepEqual(sent, [
    {
      result: {
        status: "success",
        redirectTo: `/club-claims/${claimID}?notice=claim-approved`,
      },
      call: {
        path: `/admin/v1/club-claims/${claimID}/approve`,
        method: "POST",
        body: { expected_updated_at: version, reason: command.reason },
      },
    },
    {
      result: {
        status: "success",
        redirectTo: `/club-claims/${claimID}?notice=claim-approved`,
      },
      call: {
        path: `/admin/v1/club-claims/${claimID}/approve`,
        method: "POST",
        body: {
          expected_updated_at: version,
          reason: command.reason,
          name: "Chess Club",
          slug: "chess-club-fixture-u",
          type: "student_club",
        },
      },
    },
    {
      result: {
        status: "success",
        redirectTo: `/club-claims/${claimID}?notice=claim-rejected`,
      },
      call: {
        path: `/admin/v1/club-claims/${claimID}/reject`,
        method: "POST",
        body: { expected_updated_at: version, reason: "No evidence" },
      },
    },
  ]);
});

test("approving a claim on a club that already has an owner says so", async () => {
  const validated = validateCatalogCommandInput(form(command));
  assert.ok(validated.valid);
  const api = (async () => {
    throw new AdminApiError(409, "club_already_claimed");
  }) as ApiClient;
  assert.deepEqual(
    await runCatalogCommandOperation(validated.value, { api, ...mutation }),
    {
      status: "error",
      message:
        "The club already has an owner, so this claim cannot be approved. Reject it instead.",
      notice: "club-already-claimed",
    },
  );
});

test("the claim queue filters by status", async () => {
  const search = validateCatalogSearch("club_claims")({
    state: "pending",
    q: "ignored",
  });
  const { api, calls } = recordingApi(() => ({
    claims: [],
    next_cursor: "",
    previous_cursor: "",
  }));
  await listClubClaimsOperation(search, { api, cookieHeader: "admin" });
  assert.deepEqual(calls, [
    {
      path: "/admin/v1/club-claims?limit=25&status=pending",
      method: undefined,
      body: undefined,
    },
  ]);
  assert.deepEqual(validateCatalogSearch("club_claims")({ state: "open" }), {
    state: undefined,
  });
});
