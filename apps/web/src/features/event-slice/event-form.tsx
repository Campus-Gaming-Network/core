import { useServerFn } from "@tanstack/react-start";
import type { FormEvent } from "react";
import {
  FieldError,
  FormErrorSummary,
  fieldErrorProps,
  useEnhancedMutation,
} from "../../components/enhanced-mutation.js";
import { FormField } from "../../components/form-field";
import { GamePickerExtras } from "../../components/game-picker";
import { FormSection } from "../../components/form-section";
import { useIdempotencyKey } from "../../components/idempotency-key.js";
import type {
  EventDTO,
  EventFormSchoolDTO,
  EventGameDTO,
} from "./contracts.js";
import { createEvent, updateEvent } from "./event.functions.js";
import {
  eventTimeZoneLabel,
  eventTimeZones,
  instantToLocalDateTime,
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
  /** Server-rendered key for create mode; see useIdempotencyKey. */
  idempotencyKey?: string;
};

const visibilityOptions = [
  { value: "public", label: "Public", hint: "Anyone can find this event" },
  { value: "unlisted", label: "Unlisted", hint: "Only people with the link" },
  { value: "private", label: "Private", hint: "Password required" },
] as const;

export function EventForm({
  mode,
  event,
  games,
  schools,
  defaultSchoolID,
  defaultSchool,
  defaultTimeZone,
  initialSchoolQuery,
  initialSchoolSearchFailed,
  idempotencyKey = "",
}: Props) {
  const idempotency = useIdempotencyKey(idempotencyKey);
  const runCreateEvent = useServerFn(createEvent);
  const runUpdateEvent = useServerFn(updateEvent);
  const mutation = useEnhancedMutation(
    mode === "create"
      ? "We could not create that event. Please try again."
      : "We could not update that event. Please try again.",
  );
  const selectedSchool = event?.host_school ?? defaultSchool;
  const selectedSchoolID = event?.host_school.id ?? defaultSchoolID ?? "";
  const timeZone = event?.timezone ?? defaultTimeZone ?? "America/Los_Angeles";
  const timeZoneOptions = eventTimeZones.some(
    (option) => option.id === timeZone,
  )
    ? eventTimeZones
    : ([{ id: timeZone, label: timeZone }, ...eventTimeZones] as const);
  // The picker lists active games only. Keep an event's other games, retired
  // or typed in, selectable so saving other changes does not drop them.
  const retiredGames =
    event?.games.filter(
      (eventGame) => !games.some((game) => game.id === eventGame.id),
    ) ?? [];

  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const data = new FormData(formEvent.currentTarget);
    await mutation.execute(() =>
      mode === "create" ? runCreateEvent({ data }) : runUpdateEvent({ data }),
    );
  }

  function errors(field: string): string[] | undefined {
    return mutation.fieldErrors[field];
  }

  const errorFieldIds = Object.fromEntries(
    Object.keys(mutation.fieldErrors).map((field) => [
      field,
      field === "host_school_id"
        ? "event-school-error"
        : `event-${field.replaceAll("_", "-")}-error`,
    ]),
  );

  return (
    <form
      action={mode === "create" ? createEvent.url : updateEvent.url}
      className="form-stack event-form sectioned-form"
      method="post"
      onSubmit={submit}
    >
      {event ? <input name="slug" type="hidden" value={event.slug} /> : null}
      {mode === "create" ? (
        <input name="idempotency_key" type="hidden" value={idempotency.key} />
      ) : null}
      <FormErrorSummary
        fieldErrors={mutation.fieldErrors}
        fieldIds={errorFieldIds}
        message={mutation.message}
        summaryRef={mutation.errorSummaryRef}
      />

      <FormSection
        title="Event basics"
        description="Give people enough information to understand the event at a glance."
      >
        <FormField
          errorId="event-title-error"
          errors={errors("title")}
          label="Title"
        >
          <input
            defaultValue={event?.title ?? ""}
            maxLength={120}
            name="title"
            required
          />
        </FormField>

        <FormField
          errorId="event-description-error"
          errors={errors("description")}
          label="Description"
        >
          <textarea
            defaultValue={event?.description ?? ""}
            maxLength={5000}
            name="description"
            rows={6}
          />
        </FormField>

        <FormField
          errorId="event-format-error"
          errors={errors("format")}
          label="Format"
        >
          <select
            defaultValue={event?.format ?? "in_person"}
            name="format"
            required
          >
            <option value="in_person">In person</option>
            <option value="online">Online</option>
            <option value="hybrid">Hybrid</option>
          </select>
        </FormField>

        <fieldset className="choice-group">
          <legend>Visibility</legend>
          <div className="choice-cards">
            {visibilityOptions.map((option) => (
              <label className="choice-card" key={option.value}>
                <input
                  defaultChecked={
                    (event?.visibility ?? "public") === option.value
                  }
                  name="visibility"
                  required
                  type="radio"
                  value={option.value}
                  {...fieldErrorProps(
                    errors("visibility"),
                    "event-visibility-error",
                  )}
                />
                <span className="choice-card-title">{option.label}</span>
                <span className="choice-card-hint">{option.hint}</span>
              </label>
            ))}
          </div>
          <FieldError
            id="event-visibility-error"
            messages={errors("visibility")}
          />
        </fieldset>

        {/* The password stays in the form for every visibility so a native
            submission can always send it. CSS only emphasizes it while
            Private is selected; the server validates the combination. */}
        <div className="event-private-password">
          <FormField
            errorId="event-private-password-error"
            errors={errors("private_password")}
            label="Private event password"
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
            />
          </FormField>
          <p className="form-help">
            Only used when visibility is Private. Use at least 8 characters.
          </p>
        </div>
      </FormSection>

      <FormSection
        title="When"
        description="Enter the local date and time for the selected time zone."
      >
        <FormField
          errorId="event-timezone-error"
          errors={errors("timezone")}
          label="Time zone"
        >
          <select defaultValue={timeZone} name="timezone" required>
            {timeZoneOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {eventTimeZoneLabel(option.id)}
              </option>
            ))}
          </select>
        </FormField>
        <div className="split-fields">
          <FormField
            errorId="event-starts-at-error"
            errors={errors("starts_at")}
            label="Starts at"
          >
            <input
              defaultValue={
                event ? instantToLocalDateTime(event.starts_at, timeZone) : ""
              }
              name="starts_at"
              required
              step={60}
              type="datetime-local"
            />
          </FormField>
          <FormField
            errorId="event-ends-at-error"
            errors={errors("ends_at")}
            label="Ends at"
          >
            <input
              defaultValue={
                event ? instantToLocalDateTime(event.ends_at, timeZone) : ""
              }
              name="ends_at"
              required
              step={60}
              type="datetime-local"
            />
          </FormField>
        </div>
        {mode === "create" ? (
          <>
            <div className="split-fields">
              <FormField
                errorId="event-recurrence-rule-error"
                errors={errors("recurrence_rule")}
                label="Repeat"
              >
                <select defaultValue="" name="recurrence_rule">
                  <option value="">Does not repeat</option>
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Every two weeks</option>
                  <option value="monthly">Monthly</option>
                </select>
              </FormField>
              <FormField
                errorId="event-recurrence-until-error"
                errors={errors("recurrence_until")}
                label="Repeat until"
              >
                <input name="recurrence_until" type="date" />
              </FormField>
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
      </FormSection>

      <FormSection
        title="Where"
        description="Pick the host school and say where people should show up."
      >
        <EventSchoolPicker
          defaultSchool={selectedSchool}
          defaultSchoolID={selectedSchoolID}
          describedBy={
            errors("host_school_id") ? "event-school-error" : undefined
          }
          initialQuery={initialSchoolQuery}
          initialSchools={schools}
          initialSearchFailed={initialSchoolSearchFailed}
          invalid={Boolean(errors("host_school_id"))}
        />
        <FieldError
          id="event-school-error"
          messages={errors("host_school_id")}
        />
        <div className="split-fields">
          <FormField
            errorId="event-location-name-error"
            errors={errors("location_name")}
            label="Location name"
          >
            <input
              defaultValue={event?.location_name ?? ""}
              maxLength={200}
              name="location_name"
              placeholder="Student Union"
            />
          </FormField>
          <FormField
            errorId="event-online-url-error"
            errors={errors("online_url")}
            label="Online URL"
          >
            <input
              defaultValue={event?.online_url ?? ""}
              maxLength={500}
              name="online_url"
              placeholder="https://..."
              type="url"
            />
          </FormField>
        </div>
        <FormField
          errorId="event-address-error"
          errors={errors("address")}
          label="Address"
        >
          <input
            defaultValue={event?.address ?? ""}
            maxLength={1000}
            name="address"
            placeholder="Optional for in-person or hybrid events"
          />
        </FormField>
      </FormSection>

      <FormSection
        title="Games and capacity"
        description="Choose what will be played and how many can attend."
      >
        <FormField
          errorId="event-game-ids-error"
          errors={errors("game_ids")}
          label="Games"
        >
          <select
            defaultValue={event?.games.map((game) => game.id)}
            multiple
            name="game_ids"
          >
            {games.map((game) => (
              <option key={game.id} value={game.id}>
                {game.name}
              </option>
            ))}
            {retiredGames.map((game) => (
              <option key={game.id} value={game.id}>
                {game.name} (not in the list)
              </option>
            ))}
          </select>
        </FormField>
        <GamePickerExtras
          otherGameErrorId="event-other-game-error"
          otherGameErrors={errors("other_game")}
        />
        <FormField
          errorId="event-capacity-error"
          errors={errors("capacity")}
          label="Capacity"
        >
          <input
            defaultValue={event?.capacity?.toString() ?? ""}
            min={1}
            name="capacity"
            placeholder="Optional"
            type="number"
          />
        </FormField>
      </FormSection>

      <FormSection
        title="Paid event details"
        description="Off-site payment info for events that charge attendees."
      >
        <label className="checkbox-field">
          <input
            defaultChecked={event?.is_paid}
            name="is_paid"
            type="checkbox"
          />
          <span>This event has off-site payment instructions.</span>
        </label>
        <FormField
          errorId="event-payment-note-error"
          errors={errors("payment_note")}
          label="Payment note"
        >
          <textarea
            defaultValue={event?.payment_note ?? ""}
            maxLength={1000}
            name="payment_note"
            placeholder="Tell attendees how payment works outside CGN."
            rows={3}
          />
        </FormField>
        <FormField
          errorId="event-payment-url-error"
          errors={errors("payment_url")}
          label="Payment URL"
        >
          <input
            defaultValue={event?.payment_url ?? ""}
            maxLength={500}
            name="payment_url"
            placeholder="https://..."
            type="url"
          />
        </FormField>
      </FormSection>

      <div className="form-actions">
        <button disabled={mutation.pending} type="submit">
          {mutation.pending
            ? mode === "create"
              ? "Creating…"
              : "Saving…"
            : mode === "create"
              ? "Create event"
              : "Save event"}
        </button>
      </div>
    </form>
  );
}
