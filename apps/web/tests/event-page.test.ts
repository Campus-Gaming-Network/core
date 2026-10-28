import assert from "node:assert/strict";
import { test, vi } from "vite-plus/test";
import { getEventViewerSession } from "../src/features/event-slice/auth.functions.js";
import type { EventDTO } from "../src/features/event-slice/contracts.js";
import { getEventDetail } from "../src/features/event-slice/event.functions.js";
import { getEventActivity } from "../src/features/event-activity/activity.functions.js";
import { getEventAttendees } from "../src/features/people-slice/people.functions.js";
import { Route } from "../src/routes/events.$slug.js";
import { routeEvent } from "./route-fixtures.js";
import { loadRoute } from "./route-test.js";

vi.mock("../src/features/event-slice/auth.functions.js", () => ({
  getEventViewerSession: vi.fn(),
}));
vi.mock("../src/features/event-slice/event.functions.js", () => ({
  getEventDetail: vi.fn(),
  cancelEvent: { url: "/test/cancel" },
  reportEvent: { url: "/test/report" },
  rsvpEvent: { url: "/test/rsvp" },
  setEventInterest: { url: "/test/interest" },
  unlockEvent: { url: "/test/unlock" },
}));
vi.mock("../src/features/event-activity/activity.functions.js", () => ({
  getEventActivity: vi.fn(),
}));
vi.mock("../src/features/people-slice/people.functions.js", () => ({
  getEventAttendees: vi.fn(),
}));

const organizerEvent: EventDTO = {
  ...routeEvent,
  visibility: "public",
  event_type: "game_night",
  audience: "open",
  cost: "paid",
  payment_note: "Entry is $5.",
  rsvp_yes_count: 3,
  games: [{ id: "game-1", name: "Chess", slug: "chess", has_cover: false }],
  organizers: [
    {
      id: "user-1",
      public_id: "public-jo",
      name: "Jo Organizer",
      role: "creator",
      verification_level: "basic",
    },
  ],
  viewer_can_edit: true,
  viewer_can_cancel: true,
  viewer_is_creator: true,
};

test("the event page states each fact once, in a summary that comes before the details", async () => {
  vi.mocked(getEventViewerSession).mockResolvedValue({
    status: "authenticated",
    authenticated: true,
    hasSessionCookie: true,
  });
  vi.mocked(getEventDetail).mockResolvedValue({
    status: "found",
    event: organizerEvent,
  });
  vi.mocked(getEventActivity).mockResolvedValue({ status: "unavailable" });
  vi.mocked(getEventAttendees).mockResolvedValue({ status: "unavailable" });

  const markup = (
    await loadRoute(Route, "/events/$slug", "/events/campus-night")
  ).render();
  const count = (pattern: RegExp) =>
    markup.match(new RegExp(pattern, "g"))?.length ?? 0;

  assert.deepEqual(
    {
      game: count(/Chess/),
      going: count(/3 going/),
      payment: count(/Entry is \$5\./),
      zone: count(/Pacific Standard Time/),
      sectionTabs: count(/aria-label="Event sections"/),
      editInHero: count(
        /class="detail-hero__actions"><a[^>]*href="\/events\/campus-night\/edit"/,
      ),
    },
    { game: 1, going: 1, payment: 1, zone: 1, sectionTabs: 0, editInHero: 1 },
  );
  assert.ok(
    markup.indexOf('class="event-summary"') <
      markup.indexOf("About this event"),
  );
  assert.match(
    markup,
    /<p class="detail-hero__meta">Game night · (<!-- -->)?Organized by/,
  );
});
