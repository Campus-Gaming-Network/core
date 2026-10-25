import { useServerFn } from "@tanstack/react-start";
import { Check, CircleHelp, X } from "lucide-react";
import type { FormEvent } from "react";
import type { EventDTO } from "../features/event-slice/contracts";
import { rsvpEvent } from "../features/event-slice/event.functions";
import { eventRSVPLabel } from "../features/event-slice/presentation";
import {
  FieldError,
  FormErrorSummary,
  fieldErrorProps,
  useEnhancedMutation,
} from "./enhanced-mutation";

const rsvpIcons = { maybe: CircleHelp, no: X, yes: Check } as const;

/**
 * The viewer's RSVP to an event: Going, Maybe, and Can't go as submit buttons
 * of one native form, with the current answer pressed. RSVPs close when the
 * event ends, and a full event still takes maybe or no.
 */
export function RSVPControl({ event }: { event: EventDTO }) {
  const runRsvpEvent = useServerFn(rsvpEvent);
  const mutation = useEnhancedMutation(
    "We could not save your RSVP. Please try again.",
  );
  const isEnded = event.lifecycle === "ended";
  const isFullForViewer =
    event.lifecycle === "full" && event.viewer_rsvp !== "yes";

  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    // The buttons stay enabled while a save is pending, so ignore a second
    // press instead of disabling them.
    if (mutation.pending) return;
    const submitter = (formEvent.nativeEvent as SubmitEvent)
      .submitter as HTMLButtonElement | null;
    const response = submitter?.value;

    if (response !== "yes" && response !== "maybe" && response !== "no") {
      await mutation.execute(async () => ({
        status: "error",
        message: "Check the highlighted fields and try again.",
        fieldErrors: { response: ["Choose yes, maybe, or no."] },
      }));
      return;
    }

    await mutation.execute(() =>
      runRsvpEvent({
        data: { slug: event.slug, response },
      }),
    );
  }

  const responseErrors = mutation.fieldErrors.response;

  return (
    <form
      action={rsvpEvent.url}
      className="rsvp-form"
      method="post"
      onSubmit={submit}
    >
      <input type="hidden" name="slug" value={event.slug} />
      <FormErrorSummary
        fieldErrors={mutation.fieldErrors}
        fieldIds={{ response: "event-rsvp-error" }}
        message={mutation.message}
        summaryRef={mutation.errorSummaryRef}
      />
      {mutation.pending ? (
        <p aria-live="polite" className="rsvp-note" role="status">
          Saving your RSVP…
        </p>
      ) : null}
      {isEnded ? (
        <p className="rsvp-note">RSVPs are closed for ended events.</p>
      ) : null}
      {isFullForViewer ? (
        <p className="rsvp-note">
          This event is full, but you can still choose maybe or no.
        </p>
      ) : null}
      <div aria-label="Your RSVP" className="rsvp-buttons" role="group">
        {(["yes", "maybe", "no"] as const).map((response) => {
          const RsvpIcon = rsvpIcons[response];
          return (
            <button
              aria-pressed={event.viewer_rsvp === response}
              {...fieldErrorProps(responseErrors, "event-rsvp-error")}
              // A disabled button drops keyboard focus to the page body, so a
              // pending save marks the buttons aria-disabled instead.
              aria-disabled={mutation.pending || undefined}
              disabled={isEnded || (response === "yes" && isFullForViewer)}
              key={response}
              name="response"
              type="submit"
              value={response}
            >
              <RsvpIcon aria-hidden="true" size={16} strokeWidth={2.25} />
              {eventRSVPLabel(response)}
            </button>
          );
        })}
      </div>
      <FieldError id="event-rsvp-error" messages={responseErrors} />
    </form>
  );
}
