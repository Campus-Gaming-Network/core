import { useRef, useState } from "react";
import { useCustomValidity } from "../../components/custom-validity.js";
import { FormField } from "../../components/form-field";
import { FormSection } from "../../components/form-section";
import type { EventDTO } from "./contracts.js";
import type { EventFieldErrors } from "./event-form.js";
import {
  eventTimeZoneLabel,
  eventTimeZones,
  instantToLocalDateTime,
} from "./event-time.js";
import {
  recurrenceUntilBounds,
  suggestEventEnd,
  validateEventEnd,
  validateRecurrence,
} from "./event-form-validation.js";
import { recurrenceRuleLabel } from "./presentation.js";

type Props = {
  mode: "create" | "edit";
  event?: EventDTO;
  defaultTimeZone?: string;
  attempted: boolean;
  errors: EventFieldErrors;
};

export function EventScheduleFields({
  mode,
  event,
  defaultTimeZone,
  attempted,
  errors,
}: Props) {
  const initialTimeZone =
    event?.timezone ?? defaultTimeZone ?? "America/Los_Angeles";
  // The date-time labels name the chosen zone so "Starts at" is unambiguous.
  const [timeZone, setTimeZone] = useState(initialTimeZone);
  const [startsAt, setStartsAt] = useState(
    event ? instantToLocalDateTime(event.starts_at, initialTimeZone) : "",
  );
  const [endsAt, setEndsAt] = useState(
    event ? instantToLocalDateTime(event.ends_at, initialTimeZone) : "",
  );
  // Until the organizer edits the end time, it follows the start time.
  const [endEdited, setEndEdited] = useState(Boolean(event));
  const [rule, setRule] = useState("");
  const [until, setUntil] = useState("");
  const endsAtRef = useRef<HTMLInputElement>(null);
  const ruleRef = useRef<HTMLSelectElement>(null);
  const untilRef = useRef<HTMLInputElement>(null);
  // Browser-side mirrors of the server rules (event-form-validation.ts).
  const endError = validateEventEnd(startsAt, endsAt);
  const recurrence =
    mode === "create"
      ? validateRecurrence({ rule, until, startsAt, endsAt })
      : {};
  const untilBounds = recurrenceUntilBounds(startsAt, endsAt);
  useCustomValidity(endsAtRef, endError);
  useCustomValidity(ruleRef, recurrence.recurrence_rule);
  useCustomValidity(untilRef, recurrence.recurrence_until);
  const timeZoneOptions = eventTimeZones.some(
    (option) => option.id === initialTimeZone,
  )
    ? eventTimeZones
    : ([
        { id: initialTimeZone, label: initialTimeZone },
        ...eventTimeZones,
      ] as const);

  return (
    <FormSection
      id="event-when"
      title="When"
      description="Enter the local start and end for the event. Repeats are optional."
    >
      <FormField
        errorId="event-timezone-error"
        errors={errors("timezone")}
        label="Time zone"
      >
        <select
          name="timezone"
          onChange={(change) => setTimeZone(change.currentTarget.value)}
          required
          value={timeZone}
        >
          {timeZoneOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {eventTimeZoneLabel(option.id)}
            </option>
          ))}
        </select>
      </FormField>
      <p className="form-help">
        {mode === "create" && defaultTimeZone ? "Set from your profile. " : ""}
        Times below are in {eventTimeZoneLabel(timeZone)}.
      </p>
      <div className="split-fields">
        <FormField
          errorId="event-starts-at-error"
          errors={errors("starts_at")}
          label={`Starts at (${eventTimeZoneLabel(timeZone)})`}
        >
          <input
            name="starts_at"
            onChange={(change) => {
              const value = change.currentTarget.value;
              setStartsAt(value);
              if (!endEdited) setEndsAt(suggestEventEnd(value));
            }}
            required
            step={60}
            type="datetime-local"
            value={startsAt}
          />
        </FormField>
        <FormField
          errorId="event-ends-at-error"
          errors={errors("ends_at", endError)}
          label={`Ends at (${eventTimeZoneLabel(timeZone)})`}
        >
          <input
            name="ends_at"
            onChange={(change) => {
              setEndEdited(true);
              setEndsAt(change.currentTarget.value);
            }}
            ref={endsAtRef}
            required
            step={60}
            type="datetime-local"
            value={endsAt}
          />
        </FormField>
      </div>
      {mode === "create" ? (
        <>
          <div className="split-fields">
            <FormField
              errorId="event-recurrence-rule-error"
              errors={errors("recurrence_rule", recurrence.recurrence_rule)}
              label="Repeat"
            >
              <select
                name="recurrence_rule"
                onChange={(change) => setRule(change.currentTarget.value)}
                ref={ruleRef}
                value={rule}
              >
                <option value="">Does not repeat</option>
                <option value="weekly">Weekly</option>
                <option value="biweekly">Every two weeks</option>
                <option value="monthly">Monthly</option>
              </select>
            </FormField>
            <FormField
              errorId="event-recurrence-until-error"
              errors={errors(
                "recurrence_until",
                recurrence.recurrence_until,
                attempted || Boolean(until),
              )}
              label="Repeat until"
            >
              <input
                max={untilBounds.max || undefined}
                min={untilBounds.min || undefined}
                name="recurrence_until"
                onChange={(change) => setUntil(change.currentTarget.value)}
                ref={untilRef}
                type="date"
                value={until}
              />
            </FormField>
          </div>
          <p className="form-help">
            Pick a repeat and an end date to create a series, up to one year
            from the start. Each occurrence is its own event: people RSVP to,
            and organizers cancel, one at a time.
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
  );
}
