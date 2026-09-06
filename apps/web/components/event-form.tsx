"use client";

import { Alert } from "@heroui/react/alert";
import { Button } from "@heroui/react/button";
import { Fieldset } from "@heroui/react/fieldset";
import { Input } from "@heroui/react/input";
import { ListBox } from "@heroui/react/list-box";
import { Select } from "@heroui/react/select";
import { TextArea } from "@heroui/react/textarea";
import { useActionState } from "react";
import { FieldError, fieldErrorProps } from "./form-field-error";
import { SchoolPicker } from "./school-picker";
import {
  createEventAction,
  updateEventAction
} from "../app/actions";
import {
  type Event,
  type Game,
  recurrenceRuleLabel,
  type School,
  type SchoolSummary
} from "../lib/cgn-api";
import {
  eventTimeZoneLabel,
  eventTimeZones,
  instantToLocalDateTime
} from "../lib/event-time";
import { initialFormState } from "../lib/form-state";

type EventFormProps = {
  mode: "create" | "edit";
  event?: Event;
  games: Game[];
  schools: School[];
  defaultSchoolID?: string;
  defaultSchool?: SchoolSummary;
  defaultTimeZone?: string;
  initialSchoolQuery?: string;
  initialSchoolSearchFailed?: boolean;
};

export function EventForm({
  mode,
  event,
  games,
  schools,
  defaultSchoolID,
  defaultSchool,
  defaultTimeZone,
  initialSchoolQuery,
  initialSchoolSearchFailed
}: EventFormProps) {
  const actionHandler = mode === "create" ? createEventAction : updateEventAction;
  const [state, action, pending] = useActionState(
    actionHandler,
    initialFormState
  );
  const selectedGameIDs = new Set(event?.games.map((game) => game.id) ?? []);
  const selectedSchoolID = event?.host_school.id ?? defaultSchoolID ?? "";
  const timeZone = event?.timezone ?? defaultTimeZone ?? "America/Los_Angeles";
  const timeZoneOptions = eventTimeZones.some(
    (option) => option.id === timeZone
  )
    ? eventTimeZones
    : [{ id: timeZone, label: timeZone }, ...eventTimeZones];

  return (
    <form action={action} className="form-stack">
      {event ? <input type="hidden" name="slug" value={event.slug} /> : null}
      {state.message ? (
        <Alert status={state.status === "error" ? "danger" : "success"}>
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
          {...fieldErrorProps(state, "title")}
        />
        <FieldError name="title" state={state} />
      </label>

      <label>
        Description
        <TextArea
          name="description"
          defaultValue={event?.description ?? ""}
          maxLength={5000}
          rows={6}
          {...fieldErrorProps(state, "description")}
        />
        <FieldError name="description" state={state} />
      </label>

      <div className="split-fields">
        <label>
          Visibility
          <Select
            fullWidth
            name="visibility"
            defaultSelectedKey={event?.visibility ?? "public"}
            aria-label="Visibility"
            isRequired
            {...fieldErrorProps(state, "visibility")}
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
          <FieldError name="visibility" state={state} />
        </label>
        <label>
          Format
          <Select
            fullWidth
            name="format"
            defaultSelectedKey={event?.format ?? "in_person"}
            aria-label="Format"
            isRequired
            {...fieldErrorProps(state, "format")}
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
          <FieldError name="format" state={state} />
        </label>
      </div>

      <Fieldset>
        <Fieldset.Legend>When</Fieldset.Legend>
        <p className="form-help">
          Enter the local date and time for the selected time zone.
        </p>
        <label>
          Time zone
          <Select
            fullWidth
            name="timezone"
            defaultSelectedKey={timeZone}
            aria-label="Time zone"
            isRequired
            {...fieldErrorProps(state, "timezone")}
          >
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {timeZoneOptions.map((option) => (
                  <ListBox.Item
                    id={option.id}
                    key={option.id}
                    textValue={eventTimeZoneLabel(option.id)}
                  >
                    {option.label}
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
          <FieldError name="timezone" state={state} />
        </label>
        <div className="split-fields">
          <label>
            Starts at
            <Input
              name="starts_at"
              defaultValue={
                event
                  ? instantToLocalDateTime(event.starts_at, timeZone)
                  : ""
              }
              required
              step={60}
              type="datetime-local"
              {...fieldErrorProps(state, "starts_at")}
            />
            <FieldError name="starts_at" state={state} />
          </label>
          <label>
            Ends at
            <Input
              name="ends_at"
              defaultValue={
                event ? instantToLocalDateTime(event.ends_at, timeZone) : ""
              }
              required
              step={60}
              type="datetime-local"
              {...fieldErrorProps(state, "ends_at")}
            />
            <FieldError name="ends_at" state={state} />
          </label>
        </div>
        {mode === "create" ? (
          <>
            <div className="split-fields">
              <label>
                Repeat
                <Select
                  fullWidth
                  name="recurrence_rule"
                  defaultSelectedKey=""
                  aria-label="Repeat event"
                  {...fieldErrorProps(state, "recurrence_rule")}
                >
                  <Select.Trigger>
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      <ListBox.Item id="" textValue="Does not repeat">
                        Does not repeat
                      </ListBox.Item>
                      <ListBox.Item id="weekly" textValue="Weekly">
                        Weekly
                      </ListBox.Item>
                      <ListBox.Item
                        id="biweekly"
                        textValue="Every two weeks"
                      >
                        Every two weeks
                      </ListBox.Item>
                      <ListBox.Item id="monthly" textValue="Monthly">
                        Monthly
                      </ListBox.Item>
                    </ListBox>
                  </Select.Popover>
                </Select>
                <FieldError name="recurrence_rule" state={state} />
              </label>
              <label>
                Repeat until
                <Input
                  name="recurrence_until"
                  type="date"
                  {...fieldErrorProps(state, "recurrence_until")}
                />
                <FieldError name="recurrence_until" state={state} />
              </label>
            </div>
            <p className="form-help">
              Recurring events create independent occurrences. Each occurrence
              can be RSVP’d to or cancelled separately.
            </p>
          </>
        ) : (
          <p className="form-help">
            {event?.recurrence_rule
              ? `This is one occurrence in a ${recurrenceRuleLabel(event.recurrence_rule).toLowerCase()} series. Changes apply only to this occurrence.`
              : "Changes apply only to this event."}{" "}
            Repeat settings cannot be changed after an event is created.
          </p>
        )}
      </Fieldset>

      <Fieldset>
        <Fieldset.Legend>Where</Fieldset.Legend>
        <div>
          <SchoolPicker
            name="host_school_id"
            label="Host school"
            initialSchools={schools}
            initialQuery={initialSchoolQuery}
            initialSearchFailed={initialSchoolSearchFailed}
            selectedSchool={event?.host_school ?? defaultSchool}
            selectedSchoolID={selectedSchoolID}
            isRequired
            {...fieldErrorProps(state, "host_school_id")}
          />
          <FieldError name="host_school_id" state={state} />
        </div>
        <div className="split-fields">
          <label>
            Location name
            <Input
              name="location_name"
              defaultValue={event?.location_name ?? ""}
              maxLength={200}
              placeholder="Student Union"
              {...fieldErrorProps(state, "location_name")}
            />
            <FieldError name="location_name" state={state} />
          </label>
          <label>
            Online URL
            <Input
              name="online_url"
              defaultValue={event?.online_url ?? ""}
              maxLength={500}
              placeholder="https://..."
              type="url"
              {...fieldErrorProps(state, "online_url")}
            />
            <FieldError name="online_url" state={state} />
          </label>
        </div>
        <label>
          Address
          <Input
            name="address"
            defaultValue={event?.address ?? ""}
            maxLength={1000}
            placeholder="Optional for in-person or hybrid events"
            {...fieldErrorProps(state, "address")}
          />
          <FieldError name="address" state={state} />
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
            {...fieldErrorProps(state, "game_ids")}
          >
            {games.map((game) => (
              <option key={game.id} value={game.id}>
                {game.name}
              </option>
            ))}
          </select>
          <FieldError name="game_ids" state={state} />
        </label>
        <label>
          Capacity
          <Input
            name="capacity"
            defaultValue={event?.capacity?.toString() ?? ""}
            min={1}
            placeholder="Optional"
            type="number"
            {...fieldErrorProps(state, "capacity")}
          />
          <FieldError name="capacity" state={state} />
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
            {...fieldErrorProps(state, "private_password")}
          />
          <FieldError name="private_password" state={state} />
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            name="is_paid"
            defaultChecked={event?.is_paid}
          />
          <span>This event has off-site payment instructions.</span>
        </label>
        <label>
          Payment note
          <TextArea
            name="payment_note"
            defaultValue={event?.payment_note ?? ""}
            maxLength={1000}
            rows={3}
            placeholder="Tell attendees how payment works outside CGN."
            {...fieldErrorProps(state, "payment_note")}
          />
          <FieldError name="payment_note" state={state} />
        </label>
        <label>
          Payment URL
          <Input
            name="payment_url"
            defaultValue={event?.payment_url ?? ""}
            maxLength={500}
            placeholder="https://..."
            type="url"
            {...fieldErrorProps(state, "payment_url")}
          />
          <FieldError name="payment_url" state={state} />
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
