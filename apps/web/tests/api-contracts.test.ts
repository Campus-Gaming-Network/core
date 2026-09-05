import assert from "node:assert/strict";
import test from "node:test";
import {
  eventDetailSchema,
  eventSchema,
  profileSchema,
  schoolSchema,
  teamSchema
} from "../lib/api-contracts.js";

const school = {
  id: "school-1",
  name: "Example University",
  slug: "example-university",
  is_main_campus: true,
  num_branches: 0
};

const game = {
  id: "game-1",
  name: "Example Game",
  slug: "example-game"
};

const event = {
  id: "event-1",
  title: "Campus tournament",
  slug: "campus-tournament",
  description: "",
  visibility: "public",
  format: "in_person",
  starts_at: "2037-02-20T02:00:00Z",
  ends_at: "2037-02-20T05:00:00Z",
  timezone: "America/Los_Angeles",
  rsvp_yes_count: 0,
  interest_count: 0,
  lifecycle: "upcoming",
  is_paid: false,
  host_school: school,
  games: [game]
};

test("catalog and profile schemas accept representative API responses", () => {
  assert.equal(schoolSchema.parse(school).slug, "example-university");

  const profile = profileSchema.parse({
    id: "user-1",
    email: "player@example.com",
    verification_level: "basic",
    name: "Player One",
    timezone: "America/Los_Angeles",
    home_school_id: "school-1",
    home_school: school,
    social_links: []
  });

  assert.equal(profile.email, "player@example.com");
});

test("event schemas validate enums, timestamps, and locked shells", () => {
  assert.equal(eventSchema.parse(event).lifecycle, "upcoming");
  assert.deepEqual(
    eventDetailSchema.parse({
      slug: "invite-only",
      visibility: "private",
      locked: true
    }),
    {
      slug: "invite-only",
      visibility: "private",
      locked: true
    }
  );

  assert.equal(
    eventSchema.safeParse({ ...event, lifecycle: "cancelled" }).success,
    false
  );
  assert.equal(
    eventSchema.safeParse({ ...event, starts_at: "tomorrow" }).success,
    false
  );
});

test("team schema rejects invalid roles and counts", () => {
  const validTeam = {
    id: "team-1",
    name: "Falcons",
    slug: "falcons",
    description: "",
    owner_user_id: "user-1",
    member_count: 1,
    games: [game],
    viewer_role: "owner"
  };

  assert.equal(teamSchema.parse(validTeam).viewer_role, "owner");
  assert.equal(
    teamSchema.safeParse({ ...validTeam, viewer_role: "admin" }).success,
    false
  );
  assert.equal(
    teamSchema.safeParse({ ...validTeam, member_count: -1 }).success,
    false
  );
});

test("response schemas tolerate additive fields but remove them from parsed data", () => {
  const parsed = eventSchema.parse({ ...event, future_api_field: true });

  assert.equal("future_api_field" in parsed, false);
});
