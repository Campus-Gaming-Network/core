import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import {
  acceptEditorInviteOperation,
  clubManagementOperation,
  runClubCommandOperation,
} from "../src/features/club-slice/club-operations.server.js";
import { validateClubCommandInput } from "../src/features/club-slice/contracts.js";
import { clubMembersOperation } from "../src/features/people-slice/people-operations.server.js";
import { personDetail } from "../src/features/people-slice/presentation.js";
import { createApiClient, type Fetcher } from "../src/server/api.server.js";
import { requestURL } from "./fetch-stub.js";

type Sent = {
  url: string;
  method?: string;
  cookie: string | null;
  body?: unknown;
};

function recordingClient(respond: (url: string) => Response) {
  const sent: Sent[] = [];
  const fetcher: Fetcher = async (input, init) => {
    const url = requestURL(input);
    sent.push({
      url,
      method: init?.method,
      cookie: new Headers(init?.headers).get("cookie"),
      ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
    });
    return respond(url);
  };
  return {
    api: createApiClient({ baseUrl: "http://api:8080", fetcher }),
    sent,
  };
}

function form(fields: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    for (const item of [value].flat()) data.append(name, item);
  }
  return data;
}

function command(fields: Record<string, string | string[]>) {
  const validated = validateClubCommandInput(form(fields));
  assert.ok(validated.valid, JSON.stringify(validated));
  return validated;
}

test("an owner invites an editor, who accepts and then edits the club's profile", async () => {
  const { api, sent } = recordingClient((url) =>
    url.endsWith("/club-editor-invites/accept")
      ? Response.json({ club_slug: "smash-club" })
      : url.endsWith("/editor-invites")
        ? Response.json(
            {
              id: "invite-1",
              email: "editor@example.test",
              expires_at: "2031-01-08T00:00:00Z",
              created_at: "2031-01-01T00:00:00Z",
            },
            { status: 201 },
          )
        : new Response(null, { status: 204 }),
  );
  const owner = { api, cookieHeader: "cgn_session=owner" };
  const editor = { api, cookieHeader: "cgn_session=editor" };

  const invite = command({
    command: "invite",
    slug: "smash-club",
    page: "manage",
    email: " Editor@Example.test ",
  });
  const invited = await runClubCommandOperation(
    invite.value,
    invite.page,
    owner,
  );
  const accepted = await acceptEditorInviteOperation(
    { token: "raw-token" },
    editor,
  );
  const profile = command({
    command: "profile",
    slug: "smash-club",
    page: "manage",
    name: " Smash Club ",
    type: "student_club",
    summary: "Weekly brackets.",
    how_to_join: "Come to a Friday meeting.",
    game_ids: ["game-1", "game-2"],
  });
  const saved = await runClubCommandOperation(
    profile.value,
    profile.page,
    editor,
  );

  assert.deepEqual(
    [invited, accepted, saved],
    [
      {
        status: "success",
        redirectTo: "/clubs/smash-club/manage?club=invited",
      },
      { status: "success", redirectTo: "/clubs/smash-club/manage?club=editor" },
      { status: "success", redirectTo: "/clubs/smash-club/manage?club=saved" },
    ],
  );
  assert.deepEqual(sent, [
    {
      url: "http://api:8080/clubs/smash-club/editor-invites",
      method: "POST",
      cookie: "cgn_session=owner",
      body: { email: "editor@example.test" },
    },
    {
      url: "http://api:8080/club-editor-invites/accept",
      method: "POST",
      cookie: "cgn_session=editor",
      body: { token: "raw-token" },
    },
    {
      url: "http://api:8080/clubs/smash-club/profile",
      method: "POST",
      cookie: "cgn_session=editor",
      body: {
        name: "Smash Club",
        type: "student_club",
        summary: "Weekly brackets.",
        how_to_join: "Come to a Friday meeting.",
        game_ids: ["game-1", "game-2"],
      },
    },
  ]);
});

test("an invite for another account or a used link returns to the invite page with why", async () => {
  const refuse = (status: number, error: string) =>
    acceptEditorInviteOperation(
      { token: "raw-token" },
      {
        api: recordingClient(() => Response.json({ error }, { status })).api,
        cookieHeader: "cgn_session=someone",
        reportError: () => {},
      },
    );
  assert.deepEqual(
    await Promise.all([
      refuse(403, "editor_invite_wrong_account"),
      refuse(404, "editor_invite_not_found"),
      refuse(500, "editor_invite_accept_failed"),
    ]),
    [
      {
        status: "success",
        redirectTo: "/club-editor-invite?result=wrong-account",
      },
      { status: "success", redirectTo: "/club-editor-invite?result=invalid" },
      { status: "success", redirectTo: "/club-editor-invite?result=failed" },
    ],
  );
});

test("link rows drop blank rows, and each command calls its own route", async () => {
  const links = command({
    command: "links",
    slug: "smash-club",
    page: "manage",
    link_type: ["discord", "website", "website"],
    link_label: ["Discord", "", ""],
    link_url: ["https://discord.example.test/smash", "", ""],
  });
  assert.deepEqual(links.value, {
    command: "links",
    slug: "smash-club",
    links: [
      {
        type: "discord",
        label: "Discord",
        url: "https://discord.example.test/smash",
      },
    ],
  });

  const memberID = "22222222-2222-4222-8222-222222222222";
  const { api, sent } = recordingClient(
    () => new Response(null, { status: 204 }),
  );
  const results = [];
  const commands: Array<Record<string, string>> = [
    { command: "revoke-invite", invite_id: "invite-1", page: "manage" },
    { command: "remove-member", user_id: memberID, page: "manage" },
    { command: "offer", user_id: memberID, page: "manage" },
    { command: "cancel-offer", page: "club" },
    { command: "accept-offer", page: "club" },
    { command: "leave", page: "club" },
  ];
  for (const fields of commands) {
    const validated = command({ ...fields, slug: "smash-club" });
    results.push(
      await runClubCommandOperation(validated.value, validated.page, {
        api,
        cookieHeader: "cgn_session=x",
      }),
    );
  }
  assert.deepEqual(
    results.map((result) =>
      result.status === "success" ? result.redirectTo : result.status,
    ),
    [
      "/clubs/smash-club/manage?club=invite-withdrawn",
      "/clubs/smash-club/manage?club=removed",
      "/clubs/smash-club/manage?club=offered",
      "/clubs/smash-club?club=offer-withdrawn",
      "/clubs/smash-club/manage?club=owner",
      "/clubs/smash-club?club=left",
    ],
  );
  assert.deepEqual(
    sent.map(
      ({ url, method, body }) =>
        `${method} ${url.replace("http://api:8080", "")} ${JSON.stringify(body ?? null)}`,
    ),
    [
      "DELETE /clubs/smash-club/editor-invites/invite-1 null",
      `POST /clubs/smash-club/remove-member {"user_id":"${memberID}"}`,
      `POST /clubs/smash-club/ownership-offer {"user_id":"${memberID}"}`,
      "DELETE /clubs/smash-club/ownership-offer null",
      "POST /clubs/smash-club/ownership-offer/accept null",
      "POST /clubs/smash-club/leave null",
    ],
  );
});

test("the last owner leaving and an outsider's edit come back as notices", async () => {
  const refuse = (status: number, error: string) => {
    const leave = command({
      command: "leave",
      slug: "smash-club",
      page: "club",
    });
    return runClubCommandOperation(leave.value, leave.page, {
      api: recordingClient(() => Response.json({ error }, { status })).api,
      cookieHeader: "cgn_session=x",
      reportError: () => {},
    });
  };
  assert.deepEqual(
    await Promise.all([
      refuse(409, "last_club_owner"),
      refuse(403, "not_club_officer"),
    ]),
    [
      {
        status: "error",
        notice: "last-owner",
        message:
          "You are the club's last owner. Offer the club to another member before you leave.",
      },
      {
        status: "error",
        notice: "not-allowed",
        message: "You do not have permission to do that.",
      },
    ],
  );
});

test("the Manage page needs a session and an owner or editor", async () => {
  const forbidden = recordingClient((url) =>
    url.endsWith("/manage")
      ? Response.json({ error: "not_club_officer" }, { status: 403 })
      : Response.json({ games: [] }),
  );
  assert.deepEqual(
    await Promise.all([
      clubManagementOperation(
        { slug: "smash-club" },
        { api: forbidden.api, cookieHeader: "" },
      ),
      clubManagementOperation(
        { slug: "smash-club" },
        {
          api: forbidden.api,
          cookieHeader: "cgn_session=x",
          sessionCookieValue: "x",
        },
      ),
    ]),
    [{ status: "unauthenticated" }, { status: "forbidden" }],
  );
});

test("joining on CGN posts with the session and returns to the club page", async () => {
  const { api, sent } = recordingClient(
    () => new Response(null, { status: 204 }),
  );
  const join = command({ command: "join", slug: "smash-club", page: "club" });
  const joined = await runClubCommandOperation(join.value, join.page, {
    api,
    cookieHeader: "cgn_session=student",
  });
  const unverified = await runClubCommandOperation(join.value, join.page, {
    api: recordingClient(() =>
      Response.json({ error: "email_verification_required" }, { status: 403 }),
    ).api,
    cookieHeader: "cgn_session=new",
    reportError: () => {},
  });
  assert.deepEqual(
    { joined, unverified, sent },
    {
      joined: {
        status: "success",
        redirectTo: "/clubs/smash-club?club=joined",
      },
      unverified: {
        status: "error",
        notice: "not-allowed",
        message: "Verify your email address first, then try once more.",
      },
      sent: [
        {
          url: "http://api:8080/clubs/smash-club/join",
          method: "POST",
          cookie: "cgn_session=student",
        },
      ],
    },
  );
});

test("a club's people list needs a session and shows each person's club role", async () => {
  const { api, sent } = recordingClient(() =>
    Response.json({
      people: [
        {
          id: "u1",
          public_id: "Ab3cDe5fGh",
          name: "Owner",
          verification_level: "basic",
          role: "owner",
          email: "strip@example.test",
        },
        {
          id: "u2",
          public_id: "Cd4eFg6hKm",
          name: "Editor",
          verification_level: "verified",
          role: "editor",
        },
      ],
      limit: 8,
      has_more: false,
      has_previous: false,
    }),
  );
  const signedOut = await clubMembersOperation(
    { slug: "smash-club", limit: 8 },
    { api, cookieHeader: "" },
  );
  const found = await clubMembersOperation(
    { slug: "smash-club", limit: 8 },
    { api, cookieHeader: "cgn_session=x" },
  );
  assert.equal(signedOut.status, "signed_out");
  assert.ok(found.status === "found");
  assert.deepEqual(
    found.list.people.map((person) => [
      person.name,
      personDetail(person),
      "email" in person,
    ]),
    [
      ["Owner", "Owner", false],
      ["Editor", "Editor", false],
    ],
  );
  assert.deepEqual(
    sent.map((request) => request.url),
    ["http://api:8080/clubs/smash-club/members?limit=8"],
  );
});
