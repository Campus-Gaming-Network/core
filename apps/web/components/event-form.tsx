"use client";

import { useActionState } from "react";
import {
  createEventAction,
  updateEventAction
} from "../app/actions";
import {
  type Event,
  type Game,
  type School
} from "../lib/cgn-api";
import { initialFormState } from "../lib/form-state";

type EventFormProps = {
  mode: "create" | "edit";
  event?: Event;
  games: Game[];
  schools: School[];
  defaultSchoolID?: string;
};

export function EventForm({
  mode,
  event,
  games,
  schools,
  defaultSchoolID
}: EventFormProps) {
  const actionHandler = mode === "create" ? createEventAction : updateEventAction;
  const [state, action, pending] = useActionState(
    actionHandler,
    initialFormState
  );
  const selectedGameIDs = new Set(event?.games.map((game) => game.id) ?? []);
  const selectedSchoolID = event?.host_school.id ?? defaultSchoolID ?? "";

  return (
    <form action={action} className="form-stack">
      {event ? <input type="hidden" name="slug" value={event.slug} /> : null}
      {state.message ? (
        <p className={`notice ${state.status}`}>{state.message}</p>
      ) : null}

      <label>
        Title
        <input
          name="title"
          defaultValue={event?.title ?? ""}
          required
          maxLength={120}
        />
      </label>

      <label>
        Description
        <textarea
          name="description"
          defaultValue={event?.description ?? ""}
          maxLength={5000}
          rows={6}
        />
      </label>

      <div className="split-fields">
        <label>
          Visibility
          <select
            name="visibility"
            defaultValue={event?.visibility ?? "public"}
            required
          >
            <option value="public">Public</option>
            <option value="unlisted">Unlisted</option>
            <option value="private">Private</option>
          </select>
        </label>
        <label>
          Format
          <select name="format" defaultValue={event?.format ?? "in_person"} required>
            <option value="in_person">In person</option>
            <option value="online">Online</option>
            <option value="hybrid">Hybrid</option>
          </select>
        </label>
      </div>

      <fieldset>
        <legend>When</legend>
        <p className="form-help">
          Use ISO timestamps for this MVP form, for example
          <code>2026-08-15T20:00:00Z</code>.
        </p>
        <div className="split-fields">
          <label>
            Starts at
            <input
              name="starts_at"
              defaultValue={event?.starts_at ?? ""}
              placeholder="2026-08-15T20:00:00Z"
              required
            />
          </label>
          <label>
            Ends at
            <input
              name="ends_at"
              defaultValue={event?.ends_at ?? ""}
              placeholder="2026-08-15T22:00:00Z"
              required
            />
          </label>
        </div>
        <label>
          Time zone
          <input
            name="timezone"
            defaultValue={event?.timezone ?? "America/Los_Angeles"}
            required
          />
        </label>
      </fieldset>

      <fieldset>
        <legend>Where</legend>
        <label>
          Host school
          <select name="host_school_id" defaultValue={selectedSchoolID} required>
            <option value="">Choose a school</option>
            {schools.map((school) => (
              <option key={school.id} value={school.id}>
                {school.name}
                {school.city || school.state
                  ? ` (${[school.city, school.state].filter(Boolean).join(", ")})`
                  : ""}
              </option>
            ))}
          </select>
        </label>
        <div className="split-fields">
          <label>
            Location name
            <input
              name="location_name"
              defaultValue={event?.location_name ?? ""}
              maxLength={200}
              placeholder="Student Union"
            />
          </label>
          <label>
            Online URL
            <input
              name="online_url"
              defaultValue={event?.online_url ?? ""}
              maxLength={500}
              placeholder="https://..."
              type="url"
            />
          </label>
        </div>
        <label>
          Address
          <input
            name="address"
            defaultValue={event?.address ?? ""}
            maxLength={1000}
            placeholder="Optional for in-person or hybrid events"
          />
        </label>
      </fieldset>

      <fieldset>
        <legend>Games and capacity</legend>
        <label>
          Games
          <select
            name="game_ids"
            defaultValue={
              selectedGameIDs.size > 0 ? Array.from(selectedGameIDs) : undefined
            }
            multiple
            required
          >
            {games.map((game) => (
              <option key={game.id} value={game.id}>
                {game.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Capacity
          <input
            name="capacity"
            defaultValue={event?.capacity?.toString() ?? ""}
            min={1}
            placeholder="Optional"
            type="number"
          />
        </label>
      </fieldset>

      <fieldset>
        <legend>Private and paid event details</legend>
        <label>
          Private event password
          <input
            name="private_password"
            type="password"
            minLength={8}
            placeholder={
              mode === "edit"
                ? "Leave blank to keep current password"
                : "Required for private events"
            }
          />
        </label>
        <label className="check-row">
          <input name="is_paid" type="checkbox" defaultChecked={event?.is_paid} />
          <span>This event has off-site payment instructions.</span>
        </label>
        <label>
          Payment note
          <textarea
            name="payment_note"
            defaultValue={event?.payment_note ?? ""}
            maxLength={1000}
            rows={3}
            placeholder="Tell attendees how payment works outside CGN."
          />
        </label>
        <label>
          Payment URL
          <input
            name="payment_url"
            defaultValue={event?.payment_url ?? ""}
            maxLength={500}
            placeholder="https://..."
            type="url"
          />
        </label>
      </fieldset>

      <button type="submit" disabled={pending}>
        {pending
          ? mode === "create"
            ? "Creating..."
            : "Saving..."
          : mode === "create"
            ? "Create event"
            : "Save event"}
      </button>
    </form>
  );
}
