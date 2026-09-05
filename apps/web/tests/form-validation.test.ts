import assert from "node:assert/strict";
import test from "node:test";
import {
  createEventFormSchema,
  createTeamFormSchema,
  deleteAccountFormSchema,
  eventInterestFormSchema,
  formValidationFailure,
  profileFormSchema,
  signupFormSchema,
  teamCaptainFormSchema,
  updateEventFormSchema
} from "../lib/form-validation.js";

function validEvent() {
  return {
    title: "Campus tournament",
    description: "Bring your controller.",
    host_school_id: "school-1",
    game_ids: ["game-1"],
    visibility: "public" as const,
    format: "in_person" as const,
    starts_at: "2037-02-20T02:00:00Z",
    ends_at: "2037-02-20T05:00:00Z",
    timezone: "America/Los_Angeles",
    location_name: "Student Union",
    address: "",
    online_url: "",
    private_password: "",
    capacity: 32,
    is_paid: false,
    payment_note: "",
    payment_url: "",
    recurrence_rule: "" as const,
    recurrence_until: undefined
  };
}

test("signup schema normalizes fields and validates age confirmation", () => {
  const valid = signupFormSchema.parse({
    email: "player@example.com",
    password: "password123",
    name: " Player One ",
    home_school_id: "school-1",
    age_confirmed: true,
    timezone: "America/Los_Angeles"
  });

  assert.equal(valid.name, "Player One");

  const invalid = signupFormSchema.safeParse({
    ...valid,
    age_confirmed: false
  });
  assert.equal(invalid.success, false);
  if (!invalid.success) {
    assert.deepEqual(
      formValidationFailure(invalid.error).fieldErrors?.age_confirmed,
      ["Confirm that you are 18 or older."]
    );
  }
});

test("event schema enforces time order and private-event passwords", () => {
  assert.equal(createEventFormSchema.safeParse(validEvent()).success, true);

  const reversed = createEventFormSchema.safeParse({
    ...validEvent(),
    ends_at: "2037-02-19T05:00:00Z"
  });
  assert.equal(reversed.success, false);
  if (!reversed.success) {
    assert.deepEqual(
      formValidationFailure(reversed.error).fieldErrors?.ends_at,
      ["End time must be after start time."]
    );
  }

  const privateWithoutPassword = createEventFormSchema.safeParse({
    ...validEvent(),
    visibility: "private"
  });
  assert.equal(privateWithoutPassword.success, false);

  assert.equal(
    updateEventFormSchema.safeParse({
      ...validEvent(),
      visibility: "private"
    }).success,
    true
  );
});

test("event schema validates recurrence and capacity relationships", () => {
  assert.equal(
    createEventFormSchema.safeParse({
      ...validEvent(),
      recurrence_rule: "weekly"
    }).success,
    false
  );
  assert.equal(
    createEventFormSchema.safeParse({
      ...validEvent(),
      recurrence_rule: "weekly",
      recurrence_until: "2038-03-01"
    }).success,
    false
  );
  assert.equal(
    createEventFormSchema.safeParse({
      ...validEvent(),
      recurrence_rule: "weekly",
      recurrence_until: "2038-02-20"
    }).success,
    true
  );
  assert.equal(
    createEventFormSchema.safeParse({ ...validEvent(), capacity: 0 }).success,
    false
  );
});

test("profile validation maps nested social-link errors to form field names", () => {
  const invalid = profileFormSchema.safeParse({
    name: "Player One",
    bio: "",
    timezone: "America/Los_Angeles",
    social_links: [{ label: "Discord", url: "discord.gg/example" }]
  });

  assert.equal(invalid.success, false);
  if (!invalid.success) {
    assert.deepEqual(
      formValidationFailure(invalid.error).fieldErrors?.social_url_0,
      ["Social link URL must use HTTP or HTTPS."]
    );
  }
});

test("team and destructive-action schemas reject incomplete input", () => {
  assert.equal(
    createTeamFormSchema.safeParse({
      name: "Falcons",
      description: "",
      school_id: "",
      game_ids: [],
      password: "password123"
    }).success,
    false
  );
  assert.equal(
    deleteAccountFormSchema.safeParse({ confirm: "delete" }).success,
    true
  );
  assert.equal(
    deleteAccountFormSchema.safeParse({ confirm: "remove" }).success,
    false
  );
});

test("toggle schemas reject tampered values and transform known booleans", () => {
  assert.equal(
    eventInterestFormSchema.parse({ slug: "event-1", interested: "true" })
      .interested,
    true
  );
  assert.equal(
    eventInterestFormSchema.safeParse({
      slug: "event-1",
      interested: "sometimes"
    }).success,
    false
  );
  assert.equal(
    teamCaptainFormSchema.safeParse({
      slug: "team-1",
      user_id: "user-1",
      captain: "1"
    }).success,
    false
  );
});
