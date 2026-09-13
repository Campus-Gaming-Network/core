import { useServerFn } from "@tanstack/react-start";
import type { FormEvent, ReactNode } from "react";
import {
  FieldError,
  fieldErrorProps,
  useEnhancedMutation
} from "../../components/enhanced-mutation.js";
import type {
  EventDTO,
  EventFormSchoolDTO,
  EventGameDTO
} from "./contracts.js";
import { createEvent, updateEvent } from "./event.functions.js";
import {
  eventTimeZoneLabel,
  eventTimeZones,
  instantToLocalDateTime
} from "./event-time.js";
import { EventSchoolPicker } from "./event-school-picker.js";
import { recurrenceRuleLabel } from "./presentation.js";

type Props = {
  mode: "create" | "edit";
  event?: EventDTO;
  games: EventGameDTO[];
  schools: EventFormSchoolDTO[];
  defaultSchoolID?: string;
  defaultSchool?: EventFormSchoolDTO;
  defaultTimeZone?: string;
  initialSchoolQuery: string;
  initialSchoolSearchFailed: boolean;
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
}: Props) {
  const runCreateEvent = useServerFn(createEvent);
  const runUpdateEvent = useServerFn(updateEvent);
  const mutation = useEnhancedMutation(
    mode === "create"
      ? "We could not create that event. Please try again."
      : "We could not update that event. Please try again."
  );
  const selectedSchool = event?.host_school ?? defaultSchool;
  const selectedSchoolID = event?.host_school.id ?? defaultSchoolID ?? "";
  const timeZone = event?.timezone ?? defaultTimeZone ?? "America/Los_Angeles";
  const timeZoneOptions = eventTimeZones.some((option) => option.id === timeZone)
    ? eventTimeZones
    : ([{ id: timeZone, label: timeZone }, ...eventTimeZones] as const);

  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const data = new FormData(formEvent.currentTarget);
    await mutation.execute(() =>
      mode === "create"
        ? runCreateEvent({ data })
        : runUpdateEvent({ data })
    );
  }

  function errors(field: string): string[] | undefined {
    return mutation.fieldErrors[field];
  }

  return (
    <form
      action={mode === "create" ? createEvent.url : updateEvent.url}
      className="form-stack event-form"
      method="post"
      onSubmit={submit}
    >
      {event ? <input name="slug" type="hidden" value={event.slug} /> : null}
      {mutation.message ? (
        <p role="alert" aria-live="polite">
          {mutation.message}
        </p>
      ) : null}

      <EventField label="Title" name="title" errors={errors("title")}>
        <input
          defaultValue={event?.title ?? ""}
          maxLength={120}
          name="title"
          required
          {...fieldErrorProps(errors("title"), "event-title-error")}
        />
      </EventField>

      <EventField
        label="Description"
        name="description"
        errors={errors("description")}
      >
        <textarea
          defaultValue={event?.description ?? ""}
          maxLength={5000}
          name="description"
          rows={6}
          {...fieldErrorProps(errors("description"), "event-description-error")}
        />
      </EventField>

      <div className="split-fields">
        <EventField
          label="Visibility"
          name="visibility"
          errors={errors("visibility")}
        >
          <select
            defaultValue={event?.visibility ?? "public"}
            name="visibility"
            required
            {...fieldErrorProps(errors("visibility"), "event-visibility-error")}
          >
            <option value="public">Public</option>
            <option value="unlisted">Unlisted</option>
            <option value="private">Private</option>
          </select>
        </EventField>
        <EventField label="Format" name="format" errors={errors("format")}>
          <select
            defaultValue={event?.format ?? "in_person"}
            name="format"
            required
            {...fieldErrorProps(errors("format"), "event-format-error")}
          >
            <option value="in_person">In person</option>
            <option value="online">Online</option>
            <option value="hybrid">Hybrid</option>
          </select>
        </EventField>
      </div>

      <fieldset>
        <legend>When</legend>
        <p className="form-help">
          Enter the local date and time for the selected time zone.
        </p>
        <EventField
          label="Time zone"
          name="timezone"
          errors={errors("timezone")}
        >
          <select
            defaultValue={timeZone}
            name="timezone"
            required
            {...fieldErrorProps(errors("timezone"), "event-timezone-error")}
          >
            {timeZoneOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {eventTimeZoneLabel(option.id)}
              </option>
            ))}
          </select>
        </EventField>
        <div className="split-fields">
          <EventField
            label="Starts at"
            name="starts_at"
            errors={errors("starts_at")}
          >
            <input
              defaultValue={
                event
                  ? instantToLocalDateTime(event.starts_at, timeZone)
                  : ""
              }
              name="starts_at"
              required
              step={60}
              type="datetime-local"
              {...fieldErrorProps(errors("starts_at"), "event-starts-at-error")}
            />
          </EventField>
          <EventField
            label="Ends at"
            name="ends_at"
            errors={errors("ends_at")}
          >
            <input
              defaultValue={
                event ? instantToLocalDateTime(event.ends_at, timeZone) : ""
              }
              name="ends_at"
              required
              step={60}
              type="datetime-local"
              {...fieldErrorProps(errors("ends_at"), "event-ends-at-error")}
            />
          </EventField>
        </div>
        {mode === "create" ? (
          <>
            <div className="split-fields">
              <EventField
                label="Repeat"
                name="recurrence_rule"
                errors={errors("recurrence_rule")}
              >
                <select
                  defaultValue=""
                  name="recurrence_rule"
                  {...fieldErrorProps(
                    errors("recurrence_rule"),
                    "event-recurrence-rule-error"
                  )}
                >
                  <option value="">Does not repeat</option>
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Every two weeks</option>
                  <option value="monthly">Monthly</option>
                </select>
              </EventField>
              <EventField
                label="Repeat until"
                name="recurrence_until"
                errors={errors("recurrence_until")}
              >
                <input
                  name="recurrence_until"
                  type="date"
                  {...fieldErrorProps(
                    errors("recurrence_until"),
                    "event-recurrence-until-error"
                  )}
                />
              </EventField>
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
      </fieldset>

      <fieldset>
        <legend>Where</legend>
        <EventSchoolPicker
          defaultSchool={selectedSchool}
          defaultSchoolID={selectedSchoolID}
          describedBy={errors("host_school_id") ? "event-school-error" : undefined}
          initialQuery={initialSchoolQuery}
          initialSchools={schools}
          initialSearchFailed={initialSchoolSearchFailed}
          invalid={Boolean(errors("host_school_id"))}
        />
        <FieldError id="event-school-error" messages={errors("host_school_id")} />
        <div className="split-fields">
          <EventField
            label="Location name"
            name="location_name"
            errors={errors("location_name")}
          >
            <input
              defaultValue={event?.location_name ?? ""}
              maxLength={200}
              name="location_name"
              placeholder="Student Union"
              {...fieldErrorProps(
                errors("location_name"),
                "event-location-name-error"
              )}
            />
          </EventField>
          <EventField
            label="Online URL"
            name="online_url"
            errors={errors("online_url")}
          >
            <input
              defaultValue={event?.online_url ?? ""}
              maxLength={500}
              name="online_url"
              placeholder="https://..."
              type="url"
              {...fieldErrorProps(errors("online_url"), "event-online-url-error")}
            />
          </EventField>
        </div>
        <EventField label="Address" name="address" errors={errors("address")}>
          <input
            defaultValue={event?.address ?? ""}
            maxLength={1000}
            name="address"
            placeholder="Optional for in-person or hybrid events"
            {...fieldErrorProps(errors("address"), "event-address-error")}
          />
        </EventField>
      </fieldset>

      <fieldset>
        <legend>Games and capacity</legend>
        <EventField label="Games" name="game_ids" errors={errors("game_ids")}>
          <select
            defaultValue={event?.games.map((game) => game.id)}
            multiple
            name="game_ids"
            required
            {...fieldErrorProps(errors("game_ids"), "event-game-ids-error")}
          >
            {games.map((game) => (
              <option key={game.id} value={game.id}>
                {game.name}
              </option>
            ))}
          </select>
        </EventField>
        <EventField
          label="Capacity"
          name="capacity"
          errors={errors("capacity")}
        >
          <input
            defaultValue={event?.capacity?.toString() ?? ""}
            min={1}
            name="capacity"
            placeholder="Optional"
            type="number"
            {...fieldErrorProps(errors("capacity"), "event-capacity-error")}
          />
        </EventField>
      </fieldset>

      <fieldset>
        <legend>Private and paid event details</legend>
        <EventField
          label="Private event password"
          name="private_password"
          errors={errors("private_password")}
        >
          <input
            minLength={8}
            maxLength={256}
            name="private_password"
            placeholder={
              mode === "edit"
                ? "Leave blank to keep current password"
                : "Required for private events"
            }
            type="password"
            {...fieldErrorProps(
              errors("private_password"),
              "event-private-password-error"
            )}
          />
        </EventField>
        <label className="checkbox-field">
          <input defaultChecked={event?.is_paid} name="is_paid" type="checkbox" />
          <span>This event has off-site payment instructions.</span>
        </label>
        <EventField
          label="Payment note"
          name="payment_note"
          errors={errors("payment_note")}
        >
          <textarea
            defaultValue={event?.payment_note ?? ""}
            maxLength={1000}
            name="payment_note"
            placeholder="Tell attendees how payment works outside CGN."
            rows={3}
            {...fieldErrorProps(errors("payment_note"), "event-payment-note-error")}
          />
        </EventField>
        <EventField
          label="Payment URL"
          name="payment_url"
          errors={errors("payment_url")}
        >
          <input
            defaultValue={event?.payment_url ?? ""}
            maxLength={500}
            name="payment_url"
            placeholder="https://..."
            type="url"
            {...fieldErrorProps(errors("payment_url"), "event-payment-url-error")}
          />
        </EventField>
      </fieldset>

      <button disabled={mutation.pending} type="submit">
        {mutation.pending
          ? mode === "create"
            ? "Creating…"
            : "Saving…"
          : mode === "create"
            ? "Create event"
            : "Save event"}
      </button>
    </form>
  );
}

function EventField({
  children,
  errors,
  label,
  name
}: {
  children: ReactNode;
  errors?: string[];
  label: string;
  name: string;
}) {
  return (
    <label>
      {label}
      {children}
      <FieldError id={`event-${name.replaceAll("_", "-")}-error`} messages={errors} />
    </label>
  );
}
