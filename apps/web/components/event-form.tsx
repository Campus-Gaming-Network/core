"use client";

import { Alert } from "@heroui/react/alert";
import { Button } from "@heroui/react/button";
import { Checkbox } from "@heroui/react/checkbox";
import { Fieldset } from "@heroui/react/fieldset";
import { Input } from "@heroui/react/input";
import { ListBox } from "@heroui/react/list-box";
import { Select } from "@heroui/react/select";
import { TextArea } from "@heroui/react/textarea";
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
        <Alert
          className={`notice ${state.status}`}
          status={state.status === "error" ? "danger" : "success"}
        >
          {state.message}
        </Alert>
      ) : null}

      <label>
        Title
        <Input
          name="title"
          defaultValue={event?.title ?? ""}
          required
          maxLength={120}
        />
      </label>

      <label>
        Description
        <TextArea
          name="description"
          defaultValue={event?.description ?? ""}
          maxLength={5000}
          rows={6}
        />
      </label>

      <div className="split-fields">
        <label>
          Visibility
          <Select
            fullWidth
            name="visibility"
            defaultSelectedKey={event?.visibility ?? "public"}
            isRequired
          >
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="public" textValue="Public">Public</ListBox.Item>
                <ListBox.Item id="unlisted" textValue="Unlisted">Unlisted</ListBox.Item>
                <ListBox.Item id="private" textValue="Private">Private</ListBox.Item>
              </ListBox>
            </Select.Popover>
          </Select>
        </label>
        <label>
          Format
          <Select
            fullWidth
            name="format"
            defaultSelectedKey={event?.format ?? "in_person"}
            isRequired
          >
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="in_person" textValue="In person">In person</ListBox.Item>
                <ListBox.Item id="online" textValue="Online">Online</ListBox.Item>
                <ListBox.Item id="hybrid" textValue="Hybrid">Hybrid</ListBox.Item>
              </ListBox>
            </Select.Popover>
          </Select>
        </label>
      </div>

      <Fieldset>
        <Fieldset.Legend>When</Fieldset.Legend>
        <p className="form-help">
          Use ISO timestamps for this MVP form, for example
          <code>2026-08-15T20:00:00Z</code>.
        </p>
        <div className="split-fields">
          <label>
            Starts at
            <Input
              name="starts_at"
              defaultValue={event?.starts_at ?? ""}
              placeholder="2026-08-15T20:00:00Z"
              required
            />
          </label>
          <label>
            Ends at
            <Input
              name="ends_at"
              defaultValue={event?.ends_at ?? ""}
              placeholder="2026-08-15T22:00:00Z"
              required
            />
          </label>
        </div>
        <label>
          Time zone
          <Input
            name="timezone"
            defaultValue={event?.timezone ?? "America/Los_Angeles"}
            required
          />
        </label>
      </Fieldset>

      <Fieldset>
        <Fieldset.Legend>Where</Fieldset.Legend>
        <label>
          Host school
          <Select
            fullWidth
            name="host_school_id"
            defaultSelectedKey={selectedSchoolID}
            isRequired
          >
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="" textValue="Choose a school">
                  Choose a school
                </ListBox.Item>
                {schools.map((school) => {
                  const label = `${school.name}${
                    school.city || school.state
                      ? ` (${[school.city, school.state].filter(Boolean).join(", ")})`
                      : ""
                  }`;

                  return (
                    <ListBox.Item id={school.id} key={school.id} textValue={label}>
                      {label}
                    </ListBox.Item>
                  );
                })}
              </ListBox>
            </Select.Popover>
          </Select>
        </label>
        <div className="split-fields">
          <label>
            Location name
            <Input
              name="location_name"
              defaultValue={event?.location_name ?? ""}
              maxLength={200}
              placeholder="Student Union"
            />
          </label>
          <label>
            Online URL
            <Input
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
          <Input
            name="address"
            defaultValue={event?.address ?? ""}
            maxLength={1000}
            placeholder="Optional for in-person or hybrid events"
          />
        </label>
      </Fieldset>

      <Fieldset>
        <Fieldset.Legend>Games and capacity</Fieldset.Legend>
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
          <Input
            name="capacity"
            defaultValue={event?.capacity?.toString() ?? ""}
            min={1}
            placeholder="Optional"
            type="number"
          />
        </label>
      </Fieldset>

      <Fieldset>
        <Fieldset.Legend>Private and paid event details</Fieldset.Legend>
        <label>
          Private event password
          <Input
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
        <Checkbox className="check-row" name="is_paid" defaultSelected={event?.is_paid}>
          <span>This event has off-site payment instructions.</span>
        </Checkbox>
        <label>
          Payment note
          <TextArea
            name="payment_note"
            defaultValue={event?.payment_note ?? ""}
            maxLength={1000}
            rows={3}
            placeholder="Tell attendees how payment works outside CGN."
          />
        </label>
        <label>
          Payment URL
          <Input
            name="payment_url"
            defaultValue={event?.payment_url ?? ""}
            maxLength={500}
            placeholder="https://..."
            type="url"
          />
        </label>
      </Fieldset>

      <Button type="submit" isDisabled={pending}>
        {pending
          ? mode === "create"
            ? "Creating..."
            : "Saving..."
          : mode === "create"
            ? "Create event"
            : "Save event"}
      </Button>
    </form>
  );
}
