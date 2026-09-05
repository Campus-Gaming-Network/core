import assert from "node:assert/strict";
import test from "node:test";
import {
  eventBodyFromForm,
  privateUnlockBodyFromForm,
  rsvpBodyFromForm,
  socialLinksFromForm,
  teamBodyFromForm,
  teamJoinBodyFromForm
} from "../lib/action-payloads.js";

test("eventBodyFromForm builds a normalized event payload", () => {
  const form = new FormData();
  form.set("title", "  Smash night  ");
  form.set("description", " Bring your controller. ");
  form.set("host_school_id", "school-1");
  form.append("game_ids", " game-1 ");
  form.append("game_ids", "game-2");
  form.set("visibility", "public");
  form.set("format", "in_person");
  form.set("starts_at", "2026-08-15T20:00:00Z");
  form.set("ends_at", "2026-08-15T22:00:00Z");
  form.set("location_name", "Student Union");
  form.set("capacity", "32");
  form.set("is_paid", "on");
  form.set("recurrence_rule", "weekly");
  form.set("recurrence_until", "2026-09-15");

  assert.deepEqual(eventBodyFromForm(form), {
    title: "Smash night",
    description: "Bring your controller.",
    host_school_id: "school-1",
    game_ids: ["game-1", "game-2"],
    visibility: "public",
    format: "in_person",
    starts_at: "2026-08-15T20:00:00Z",
    ends_at: "2026-08-15T22:00:00Z",
    timezone: "America/Los_Angeles",
    location_name: "Student Union",
    address: "",
    online_url: "",
    private_password: "",
    capacity: 32,
    is_paid: true,
    payment_note: "",
    payment_url: "",
    recurrence_rule: "weekly",
    recurrence_until: "2026-09-15"
  });
});

test("eventBodyFromForm leaves optional capacity unset and unchecked payment false", () => {
  const form = new FormData();

  assert.equal(eventBodyFromForm(form).capacity, undefined);
  assert.equal(eventBodyFromForm(form).is_paid, false);
});

test("eventBodyFromForm preserves invalid capacity as a rejected number", () => {
  const form = new FormData();
  form.set("capacity", "32 players");

  assert.equal(Number.isNaN(eventBodyFromForm(form).capacity), true);
});

test("teamBodyFromForm trims fields and repeated game IDs", () => {
  const form = new FormData();
  form.set("name", "  Falcons ");
  form.set("description", "  Competitive roster ");
  form.set("school_id", "school-1");
  form.append("game_ids", " game-1 ");
  form.set("password", " secret-pass ");

  assert.deepEqual(teamBodyFromForm(form), {
    name: "Falcons",
    description: "Competitive roster",
    school_id: "school-1",
    game_ids: ["game-1"],
    password: "secret-pass"
  });
});

test("socialLinksFromForm ignores empty rows and keeps up to three links", () => {
  const form = new FormData();
  form.set("social_label_0", " Discord ");
  form.set("social_url_0", " discord.gg/example ");
  form.set("social_label_1", " ");
  form.set("social_url_1", " ");
  form.set("social_label_2", "Twitch");
  form.set("social_url_2", "https://twitch.tv/example");

  assert.deepEqual(socialLinksFromForm(form), [
    { label: "Discord", url: "discord.gg/example" },
    { label: "Twitch", url: "https://twitch.tv/example" }
  ]);
});

test("rsvpBodyFromForm accepts only the trimmed response field", () => {
  const form = new FormData();
  form.set("response", " yes ");
  form.set("slug", "event-slug");

  assert.deepEqual(rsvpBodyFromForm(form), { response: "yes" });
});

test("privateUnlockBodyFromForm trims the password without leaking other fields", () => {
  const form = new FormData();
  form.set("password", " secret-pass ");
  form.set("slug", "private-event");

  assert.deepEqual(privateUnlockBodyFromForm(form), {
    password: "secret-pass"
  });
});

test("teamJoinBodyFromForm trims the password without leaking other fields", () => {
  const form = new FormData();
  form.set("password", " team-pass ");
  form.set("slug", "team-slug");

  assert.deepEqual(teamJoinBodyFromForm(form), { password: "team-pass" });
});
