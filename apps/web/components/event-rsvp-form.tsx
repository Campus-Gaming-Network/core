"use client";

import { Alert } from "@heroui/react/alert";
import { Button } from "@heroui/react/button";
import { useActionState } from "react";
import { rsvpEventAction } from "../app/actions";
import {
  type Event,
  type EventRSVP,
  eventRSVPLabel
} from "../lib/cgn-api";
import { initialFormState } from "../lib/form-state";

type EventRSVPFormProps = {
  event: Event;
};

const responses: EventRSVP[] = ["yes", "maybe", "no"];

export function EventRSVPForm({ event }: EventRSVPFormProps) {
  const [state, action, pending] = useActionState(
    rsvpEventAction,
    initialFormState
  );
  const isEnded = event.lifecycle === "ended";
  const isFullForViewer = event.lifecycle === "full" && event.viewer_rsvp !== "yes";

  return (
    <form action={action} className="rsvp-form">
      <input type="hidden" name="slug" value={event.slug} />
      {state.message ? (
        <Alert
          aria-live="polite"
      status={state.status === "error" ? "danger" : "success"}
        >
          {state.message}
        </Alert>
      ) : null}
      <p className="form-help">
        Current RSVP:{" "}
        <strong>
          {event.viewer_rsvp ? eventRSVPLabel(event.viewer_rsvp) : "Not set"}
        </strong>
      </p>
      {isEnded ? <p className="form-help">RSVPs are closed for ended events.</p> : null}
      {isFullForViewer ? (
        <p className="form-help">This event is full, but you can still choose maybe or no.</p>
      ) : null}
      <div className="rsvp-buttons">
        {responses.map((response) => (
          <Button
            aria-pressed={event.viewer_rsvp === response}
            variant={event.viewer_rsvp === response ? "primary" : "secondary"}
            isDisabled={
              pending ||
              isEnded ||
              (response === "yes" && isFullForViewer)
            }
            key={response}
            name="response"
            type="submit"
            value={response}
          >
            {eventRSVPLabel(response)}
          </Button>
        ))}
      </div>
    </form>
  );
}
