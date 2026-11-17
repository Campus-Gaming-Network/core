import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import {
  FieldError,
  FormErrorSummary,
  useEnhancedMutation,
} from "../../components/enhanced-mutation.js";
import { FormField, RequiredFieldsNote } from "../../components/form-field";
import { GameSelect } from "../../components/game-select";
import { catalogGamesFromSummaries } from "../game-picker/game-select-helpers";
import { useUnsavedChangesGuard } from "../../components/unsaved-changes";
import { ButtonLink } from "../../components/button-link";
import { FormSection } from "../../components/form-section";
import { useIdempotencyKey } from "../../components/idempotency-key.js";
import { revealFirstInvalidField } from "../../components/reveal-invalid-field.js";
import type {
  EventDTO,
  EventFormSchoolDTO,
  EventGameDTO,
  EventHostClubDTO,
  EventHostTeamDTO,
} from "./contracts.js";
import { createEvent, updateEvent } from "./event.functions.js";
import { EventCostFields } from "./event-cost-fields.js";
import { EventScheduleFields } from "./event-schedule-fields.js";
import { EventSchoolPicker } from "./event-school-picker.js";
import { EventVisibilityFields } from "./event-visibility-fields.js";
import { eventAudienceLabels, eventTypeLabels } from "./presentation.js";

type Props = {
  mode: "create" | "edit";
  event?: EventDTO;
  games: EventGameDTO[];
  schools: EventFormSchoolDTO[];
  defaultSchoolID?: string;
  defaultSchool?: EventFormSchoolDTO;
  defaultTimeZone?: string;
  /** Teams that may host the event: the viewer's own, plus the event's. */
  hostTeams: EventHostTeamDTO[];
  /** Clubs that may host the event: the viewer's own, plus the event's. */
  hostClubs: EventHostClubDTO[];
  initialSchoolQuery: string;
  initialSchoolSearchFailed: boolean;
  idempotencyKey?: string;
};

/**
 * Returns the messages to show for a field. A local message wins over the last
 * server answer once `ready` says it may be shown.
 */
export type EventFieldErrors = (
  field: string,
  local?: string | null,
  ready?: boolean,
) => string[] | undefined;

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

export function EventForm({
  mode,
  event,
  games,
  schools,
  defaultSchoolID,
  defaultSchool,
  defaultTimeZone,
  hostTeams,
  hostClubs,
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
  // Most campus gaming events are played online, so a new event starts there.
  const [format, setFormat] = useState<keyof typeof formatHints>(
    event?.format ?? "online",
  );
  // Incomplete-but-not-wrong values, such as a repeat with no end date, are
  // flagged only after a submit attempt.
  const [attempted, setAttempted] = useState(false);
  const { formRef, dialog: leaveDialog } = useUnsavedChangesGuard();
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

  const errors: EventFieldErrors = (field, local, ready = true) =>
    local && ready ? [local] : mutation.fieldErrors[field];

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
        onInvalidCapture={(invalidEvent) => {
          setAttempted(true);
          revealFirstInvalidField(invalidEvent);
        }}
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
          description="Tell people what is happening and why they should come."
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
          {event?.tournament ? (
            <p className="form-help">
              This event has tournament settings, so its type stays Tournament.
              Delete the draft settings to change it.
            </p>
          ) : null}

          {/* Only a viewer who owns or captains a team, or owns or edits a
              club, gets the choice; the event then reads "Hosted by" the team
              or club instead of its organizer. A club hosts only at its own
              school. */}
          {hostTeams.length > 0 || hostClubs.length > 0 ? (
            <FormField
              errorId="event-host-error"
              errors={errors("host_team_id") ?? errors("host_club_id")}
              label="Hosted by"
            >
              <select
                defaultValue={
                  event?.host_team
                    ? `team:${event.host_team.id}`
                    : event?.host_club
                      ? `club:${event.host_club.id}`
                      : ""
                }
                name="host"
              >
                <option value="">Just me</option>
                {hostTeams.length > 0 ? (
                  <optgroup label="Teams">
                    {hostTeams.map((team) => (
                      <option key={team.id} value={`team:${team.id}`}>
                        {team.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {hostClubs.length > 0 ? (
                  <optgroup label="Clubs">
                    {hostClubs.map((club) => (
                      <option key={club.id} value={`club:${club.id}`}>
                        {club.school
                          ? `${club.name} (${club.school.name})`
                          : club.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
            </FormField>
          ) : null}
          {hostClubs.length > 0 ? (
            <p className="form-help">
              A club hosts events at its own school, and any of its owners or
              editors can change or cancel them.
            </p>
          ) : null}

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

        <EventScheduleFields
          attempted={attempted}
          defaultTimeZone={defaultTimeZone}
          errors={errors}
          event={event}
          mode={mode}
        />

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
          {event?.tournament ? (
            <p className="form-help">
              {`The tournament is played in ${event.tournament.game.name}, so that game stays on the event while it has settings.`}
            </p>
          ) : null}
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

        <EventCostFields errors={errors} event={event} />

        <EventVisibilityFields
          attempted={attempted}
          errors={errors}
          event={event}
          mode={mode}
        />

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

export const eventFormSections = [
  { id: "event-basics", label: "Event basics" },
  { id: "event-when", label: "When" },
  { id: "event-where", label: "Where" },
  { id: "event-games", label: "Games and capacity" },
  { id: "event-cost", label: "Cost" },
  { id: "event-visibility", label: "Visibility" },
];
