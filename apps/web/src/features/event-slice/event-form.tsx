import { useServerFn } from "@tanstack/react-start";
import { useHydrated } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  FieldError,
  FormErrorSummary,
  fieldErrorProps,
  useEnhancedMutation,
} from "../../components/enhanced-mutation.js";
import { FormField, RequiredFieldsNote } from "../../components/form-field";
import { PasswordInput } from "../../components/password-input";
import { GameSelect } from "../../components/game-select";
import { catalogGamesFromSummaries } from "../game-picker/game-select-helpers";
import { useUnsavedChangesGuard } from "../../components/unsaved-changes";
import { ButtonLink } from "../../components/button-link";
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
import {
  recurrenceUntilBounds,
  suggestEventEnd,
  validateEventEnd,
  validatePrivatePassword,
  validateRecurrence,
} from "./event-form-validation.js";
import { EventSchoolPicker } from "./event-school-picker.js";
import {
  eventAudienceLabels,
  eventTypeLabels,
  recurrenceRuleLabel,
} from "./presentation.js";

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

/** Says which of the place fields matter for each format. */
const formatHints = {
  in_person:
    "People show up in person: add the place and address. An online link is not needed.",
  online:
    "People join online: add the link they join with. A place and address are not needed.",
  hybrid:
    "People can show up or join online: add the place and address, and the online link.",
} as const;

const audienceOptions = [
  { value: "open", hint: "anyone can come" },
  { value: "collegiate", hint: "students at any school" },
  { value: "campus", hint: "students and staff of the host school" },
  { value: "members", hint: "members of the hosting group" },
] as const;

const costOptions = [
  {
    value: "unspecified",
    label: "Not specified",
    hint: "Say nothing about cost",
  },
  { value: "free", label: "Free", hint: "No charge to attend" },
  { value: "paid", label: "Paid", hint: "Payment happens off CGN" },
] as const;

const visibilityOptions = [
  {
    value: "public",
    label: "Public",
    hint: "Listed in search and browse. Anyone can view it.",
  },
  {
    value: "unlisted",
    label: "Unlisted",
    hint: "Not listed. Anyone with the link can view it.",
  },
  {
    value: "private",
    label: "Private",
    hint: "Not listed. Details stay locked until someone enters the password.",
  },
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
  const initialTimeZone =
    event?.timezone ?? defaultTimeZone ?? "America/Los_Angeles";
  // The date-time labels name the chosen zone so "Starts at" is unambiguous.
  const [timeZone, setTimeZone] = useState(initialTimeZone);
  const initialStartsAt = event
    ? instantToLocalDateTime(event.starts_at, initialTimeZone)
    : "";
  const initialEndsAt = event
    ? instantToLocalDateTime(event.ends_at, initialTimeZone)
    : "";
  const hydrated = useHydrated();
  const [startsAt, setStartsAt] = useState(initialStartsAt);
  const [endsAt, setEndsAt] = useState(initialEndsAt);
  // Until the organizer edits the end time, it follows the start time.
  const [endEdited, setEndEdited] = useState(Boolean(event));
  const [rule, setRule] = useState("");
  const [until, setUntil] = useState("");
  // Most campus gaming events are played online, so a new event starts there.
  const [format, setFormat] = useState<keyof typeof formatHints>(
    event?.format ?? "online",
  );
  const [visibility, setVisibility] = useState<string>(
    event?.visibility ?? "public",
  );
  const [password, setPassword] = useState("");
  const [cost, setCost] = useState<string>(event?.cost ?? "unspecified");
  // Incomplete-but-not-wrong values (a repeat with no end date, a short
  // password) are flagged only after a submit attempt or leaving the field.
  const [attempted, setAttempted] = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);
  const endsAtRef = useRef<HTMLInputElement>(null);
  const ruleRef = useRef<HTMLSelectElement>(null);
  const untilRef = useRef<HTMLInputElement>(null);
  const { formRef, dialog: leaveDialog } = useUnsavedChangesGuard();
  // Browser-side mirrors of the server rules (event-form-validation.ts). They
  // set a custom validity so a scripted submit stops at the first problem.
  // Without JavaScript none of this runs and the server is the only check.
  const endError = validateEventEnd(startsAt, endsAt);
  const recurrence =
    mode === "create"
      ? validateRecurrence({ rule, until, startsAt, endsAt })
      : {};
  const ruleError = recurrence.recurrence_rule ?? "";
  const untilError = recurrence.recurrence_until ?? "";
  const passwordError = validatePrivatePassword({ visibility, password, mode });
  const untilBounds = recurrenceUntilBounds(startsAt, endsAt);
  useEffect(() => {
    endsAtRef.current?.setCustomValidity(endError ?? "");
    ruleRef.current?.setCustomValidity(ruleError);
    untilRef.current?.setCustomValidity(untilError);
    // PasswordInput does not forward a ref, so find the field by name.
    const field = formRef.current?.elements.namedItem("private_password");
    if (field instanceof HTMLInputElement) {
      field.setCustomValidity(passwordError ?? "");
    }
  }, [endError, ruleError, untilError, passwordError]);
  const timeZoneOptions = eventTimeZones.some(
    (option) => option.id === initialTimeZone,
  )
    ? eventTimeZones
    : ([
        { id: initialTimeZone, label: initialTimeZone },
        ...eventTimeZones,
      ] as const);
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

  // A local message wins over the last server answer for the same field.
  function shown(
    field: string,
    local: string | null | undefined,
    ready = true,
  ): string[] | undefined {
    return local && ready ? [local] : errors(field);
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
    <>
      <form
        action={mode === "create" ? createEvent.url : updateEvent.url}
        className="form-stack event-form sectioned-form"
        method="post"
        ref={formRef}
        onInvalidCapture={() => setAttempted(true)}
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

        <RequiredFieldsNote />
        <FormSection
          id="event-basics"
          title="Event basics"
          description="Give people enough information to understand the event at a glance."
        >
          <FormField
            errorId="event-title-error"
            errors={errors("title")}
            label="Title"
            characterCount
          >
            <input
              defaultValue={event?.title ?? ""}
              autoComplete="off"
              maxLength={120}
              name="title"
              required
            />
          </FormField>

          <FormField
            errorId="event-description-error"
            errors={errors("description")}
            label="Description"
            optional
            characterCount
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
              name="format"
              onChange={(change) =>
                setFormat(
                  change.currentTarget.value as keyof typeof formatHints,
                )
              }
              required
              value={format}
            >
              <option value="online">Online</option>
              <option value="in_person">In person</option>
              <option value="hybrid">Hybrid</option>
            </select>
          </FormField>

          {/* No type is preselected, for the same reason as the audience below. */}
          <FormField
            errorId="event-event-type-error"
            errors={errors("event_type")}
            label="Event type"
          >
            <select
              defaultValue={event?.event_type ?? ""}
              name="event_type"
              required
            >
              <option value="">Choose a type</option>
              {Object.entries(eventTypeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </FormField>

          {/* No audience is preselected: an event created before the field
            existed has none, and its organizer must choose one to save. */}
          <FormField
            errorId="event-audience-error"
            errors={errors("audience")}
            label="Who it's for"
          >
            <select
              defaultValue={event?.audience ?? ""}
              name="audience"
              required
            >
              <option value="">Choose an audience</option>
              {audienceOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {eventAudienceLabels[option.value]} ({option.hint})
                </option>
              ))}
            </select>
          </FormField>
        </FormSection>

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
            {mode === "create" && defaultTimeZone
              ? "Set from your profile. "
              : ""}
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
              errors={shown("ends_at", endError)}
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
                  errors={shown("recurrence_rule", ruleError)}
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
                  errors={shown(
                    "recurrence_until",
                    untilError,
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
                from the start. Each occurrence is its own event: people RSVP
                to, and organizers cancel, one at a time.
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
          id="event-where"
          title="Where"
          description="Pick the host school, then say where people should show up or join."
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
          <p className="form-help" id="event-format-hint">
            {formatHints[format]}
          </p>
          <div className="split-fields">
            <FormField
              errorId="event-location-name-error"
              errors={errors("location_name")}
              label="Location name"
              optional
              characterCount
            >
              <input
                defaultValue={event?.location_name ?? ""}
                autoComplete="off"
                maxLength={200}
                name="location_name"
                placeholder="Student Union"
              />
            </FormField>
            <FormField
              errorId="event-online-url-error"
              errors={errors("online_url")}
              label="Online URL"
              optional
            >
              <input
                defaultValue={event?.online_url ?? ""}
                autoCapitalize="none"
                autoComplete="off"
                inputMode="url"
                maxLength={500}
                name="online_url"
                placeholder="https://..."
                spellCheck={false}
                type="url"
              />
            </FormField>
          </div>
          <FormField
            errorId="event-address-error"
            errors={errors("address")}
            label="Address"
            optional
            characterCount
          >
            <input
              defaultValue={event?.address ?? ""}
              autoComplete="off"
              maxLength={1000}
              name="address"
              placeholder="Street, city, state"
            />
          </FormField>
        </FormSection>

        <FormSection
          id="event-games"
          title="Games and capacity"
          description="Choose what will be played and how many can attend."
        >
          <GameSelect
            catalog={catalogGamesFromSummaries(games)}
            errorId="event-game-ids-error"
            errors={errors("game_ids")}
            fallback={
              <>
                <FormField
                  errorId="event-game-ids-error"
                  errors={errors("game_ids")}
                  label="Games"
                  optional
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
                <p className="form-help">
                  Choose the games you will play, or type a name below. Leave it
                  empty for a meeting that is not about a game. Hold Ctrl (Cmd
                  on Mac) to choose several.
                </p>
              </>
            }
            initialGames={catalogGamesFromSummaries(event?.games ?? [])}
            label="Games"
            optional
            otherGameErrorId="event-other-game-error"
            otherGameErrors={errors("other_game")}
          />
          <FormField
            errorId="event-capacity-error"
            errors={errors("capacity")}
            label="Capacity (leave blank for no limit)"
            optional
          >
            <input
              defaultValue={event?.capacity?.toString() ?? ""}
              inputMode="numeric"
              min={1}
              name="capacity"
              step={1}
              type="number"
            />
          </FormField>
        </FormSection>

        <FormSection
          id="event-cost"
          title="Cost"
          description="Say whether the event is free. Payment happens outside CGN; the note and link apply to paid events."
        >
          <fieldset className="choice-group">
            <legend>Cost</legend>
            <div className="choice-cards">
              {costOptions.map((option) => (
                <label className="choice-card" key={option.value}>
                  <input
                    defaultChecked={
                      (event?.cost ?? "unspecified") === option.value
                    }
                    name="cost"
                    onChange={(change) => setCost(change.currentTarget.value)}
                    required
                    type="radio"
                    value={option.value}
                    {...fieldErrorProps(errors("cost"), "event-cost-error")}
                  />
                  <span className="choice-card-title">{option.label}</span>
                  <span className="choice-card-hint">{option.hint}</span>
                </label>
              ))}
            </div>
            <FieldError id="event-cost-error" messages={errors("cost")} />
          </fieldset>
          {/* Hidden only once the page is interactive, so a native submission
            still carries the values; a free event keeps what was typed. */}
          <div
            className="event-payment-fields"
            hidden={hydrated && cost !== "paid"}
          >
            <FormField
              errorId="event-payment-note-error"
              errors={errors("payment_note")}
              label="Payment note"
              optional
              characterCount
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
              optional
            >
              <input
                defaultValue={event?.payment_url ?? ""}
                autoCapitalize="none"
                autoComplete="off"
                inputMode="url"
                maxLength={500}
                name="payment_url"
                placeholder="https://..."
                spellCheck={false}
                type="url"
              />
            </FormField>
          </div>
        </FormSection>

        <FormSection
          id="event-visibility"
          title="Visibility"
          description="Choose who can find and open the event page."
        >
          <fieldset className="choice-group">
            <legend>Who can see it</legend>
            <div className="choice-cards">
              {visibilityOptions.map((option) => (
                <label className="choice-card" key={option.value}>
                  <input
                    defaultChecked={
                      (event?.visibility ?? "public") === option.value
                    }
                    name="visibility"
                    onChange={(change) =>
                      setVisibility(change.currentTarget.value)
                    }
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
              errors={shown(
                "private_password",
                passwordError,
                visibility !== "private" || attempted || passwordTouched,
              )}
              label="Private event password"
            >
              <PasswordInput
                autoComplete="new-password"
                maxLength={256}
                minLength={8}
                name="private_password"
                onBlur={() => setPasswordTouched(true)}
                onChange={(change) => setPassword(change.currentTarget.value)}
                placeholder={
                  mode === "edit"
                    ? "Leave blank to keep current password"
                    : "Required for private events"
                }
                value={password}
              />
            </FormField>
            <p className="form-help">
              {visibility !== "private"
                ? "Only used when visibility is Private."
                : mode === "edit"
                  ? "Leave blank to keep the current password, or enter a new one of at least 8 characters."
                  : "Required. Use at least 8 characters and share it with the people you invite."}
            </p>
          </div>
        </FormSection>

        <div className="form-actions">
          <ButtonLink
            to={event ? "/events/$slug" : "/events"}
            params={event ? { slug: event.slug } : undefined}
            variant="secondary"
          >
            Cancel
          </ButtonLink>
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
      {leaveDialog}
    </>
  );
}

/** The form's sections, in order, for the page's in-page section nav. */
export const eventFormSections = [
  { id: "event-basics", label: "Event basics" },
  { id: "event-when", label: "When" },
  { id: "event-where", label: "Where" },
  { id: "event-games", label: "Games and capacity" },
  { id: "event-cost", label: "Cost" },
  { id: "event-visibility", label: "Visibility" },
];
