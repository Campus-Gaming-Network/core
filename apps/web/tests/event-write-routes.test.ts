import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vite-plus/test";
import { getEditEventPage } from "../src/features/event-slice/event.functions.js";
import { Route } from "../src/routes/events.$slug_.edit.js";
import { routeEvent } from "./route-fixtures.js";
import { loadRoute } from "./route-test.js";

vi.mock("../src/features/event-slice/event.functions.js", () => ({
  getEditEventPage: vi.fn(),
  createEvent: { url: "/test/create-event" },
  updateEvent: { url: "/test/update-event" },
}));
vi.mock("../src/features/event-organizers/organizer.functions.js", () => ({
  getOrganizerInvites: vi.fn(),
  inviteOrganizer: { url: "/test/invite-organizer" },
  removeOrganizer: { url: "/test/remove-organizer" },
  revokeOrganizerInvite: { url: "/test/revoke-organizer-invite" },
}));

beforeEach(() => vi.clearAllMocks());

test("edit-event loader redirects signed-out viewers back through login", async () => {
  vi.mocked(getEditEventPage).mockResolvedValue({ status: "unauthenticated" });
  const { response } = await loadRoute(
    Route,
    "/events/$slug/edit",
    "/events/private%20night/edit",
  );
  assert.equal(response?.type, "redirect");
  assert.deepEqual(
    response?.type === "redirect"
      ? {
          href: response.redirect.options.href,
          statusCode: response.redirect.status,
        }
      : undefined,
    { href: "/login?next=/events/private%20night/edit", statusCode: 307 },
  );
});

test("edit-event loader returns a true 404 for a missing event", async () => {
  vi.mocked(getEditEventPage).mockResolvedValue({ status: "not_found" });
  const { response } = await loadRoute(
    Route,
    "/events/$slug/edit",
    "/events/missing/edit",
  );
  assert.deepEqual(
    response?.type === "render"
      ? { type: response.type, status: response.status }
      : response,
    { type: "render", status: 404 },
  );
});

test("edit-event denial renders without event details and stays private and noindex", async () => {
  vi.mocked(getEditEventPage).mockResolvedValue({
    status: "denied",
    reason: "forbidden",
  });
  const { match, render } = await loadRoute(
    Route,
    "/events/$slug/edit",
    "/events/private-night/edit",
  );
  assert.deepEqual(match?.headers, {
    "cache-control": "private, no-store",
    vary: "Cookie",
  });
  const meta = match?.meta;
  assert.ok(Array.isArray(meta));
  assert.ok(
    meta.some((tag) => tag?.title === "Edit event | Campus Gaming Network"),
  );
  assert.ok(
    meta.some(
      (tag) => tag?.name === "robots" && tag.content === "noindex,nofollow",
    ),
  );
  const markup = render();
  assert.match(markup, /Only an event organizer can change it\./);
  assert.match(markup, /href="\/events\/private-night"/);
  assert.doesNotMatch(markup, /<form/);
});

test("an editable event renders native search and a mutation form without leaking its title into metadata", async () => {
  vi.mocked(getEditEventPage).mockResolvedValue({
    status: "ready",
    event: routeEvent,
    viewerID: "editor-1",
    games: [],
    hostTeams: [],
    hostClubs: [],
    schools: [],
    schoolSearchFailed: false,
  });
  const { match, render } = await loadRoute(
    Route,
    "/events/$slug/edit",
    "/events/campus-night/edit?event=failed&school_q=Example",
  );
  assert.equal(JSON.stringify(match?.meta).includes(routeEvent.title), false);
  const markup = render();
  assert.match(markup, /We could not update that event/);
  assert.match(markup, /action="\/events\/campus-night\/edit"/);
  assert.match(markup, /action="\/test\/update-event"/);
  assert.match(markup, /name="school_q"[^>]*value="Example"/);
  assert.match(markup, /Private campus night/);
});
