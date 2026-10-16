import { Link } from "@tanstack/react-router";
import { CircleHelp, Check, Mail, Star, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { EventRSVP } from "../event-slice/contracts";
import { eventRSVPLabel } from "../event-slice/presentation";

const rsvpIcons = { maybe: CircleHelp, no: X, yes: Check } as const;

/**
 * A labelled specimen: the component's name and source file in the
 * `styleguide-label` style, then the piece itself.
 */
export function Specimen({
  children,
  file,
  name,
}: {
  children: ReactNode;
  file: string;
  name: string;
}) {
  return (
    <div className="styleguide-specimen">
      <p className="styleguide-label">
        {name} <span className="styleguide-label__file">{file}</span>
      </p>
      {children}
    </div>
  );
}

/** What a specimen note says about a piece that cannot be rendered for real. */
export function SpecimenNote({ children }: { children: ReactNode }) {
  return <p className="styleguide-note">{children}</p>;
}

/**
 * The event page's RSVP panel, as markup. The real form is private to the
 * event route and sends the answer to a server function, so this repeats its
 * structure and classes with nothing wired up. `interactive` lets the choice
 * be pressed to see each answer's color.
 */
export function RsvpPanel({
  answer,
  ended = false,
  full = false,
  interactive = false,
  signedOut = false,
}: {
  answer?: EventRSVP;
  ended?: boolean;
  full?: boolean;
  interactive?: boolean;
  signedOut?: boolean;
}) {
  const [chosen, setChosen] = useState(answer);
  const [interested, setInterested] = useState(false);
  const yesBlocked = full && chosen !== "yes";

  return (
    <section className="event-header__rsvp">
      <h3>Are you going?</h3>
      {signedOut ? (
        <Link className="button button--primary" to="/login">
          Log in to RSVP
        </Link>
      ) : (
        <>
          <form
            className="rsvp-form"
            onSubmit={(event) => event.preventDefault()}
          >
            {ended ? (
              <p className="rsvp-note">RSVPs are closed for ended events.</p>
            ) : null}
            {yesBlocked && !ended ? (
              <p className="rsvp-note">
                This event is full, but you can still choose maybe or no.
              </p>
            ) : null}
            <div aria-label="Your RSVP" className="rsvp-buttons" role="group">
              {(["yes", "maybe", "no"] as const).map((response) => {
                const Icon = rsvpIcons[response];
                return (
                  <button
                    aria-pressed={chosen === response}
                    disabled={ended || (response === "yes" && yesBlocked)}
                    key={response}
                    onClick={
                      interactive ? () => setChosen(response) : undefined
                    }
                    type="button"
                    value={response}
                  >
                    <Icon aria-hidden="true" size={16} strokeWidth={2.25} />
                    {eventRSVPLabel(response)}
                  </button>
                );
              })}
            </div>
          </form>
          <form
            className="interest-form"
            onSubmit={(event) => event.preventDefault()}
          >
            <button
              aria-pressed={interested}
              className={
                interested ? "interest-toggle is-on" : "interest-toggle"
              }
              onClick={() => setInterested(!interested)}
              type="button"
            >
              <Star
                aria-hidden="true"
                fill={interested ? "currentColor" : "none"}
                size={16}
                strokeWidth={1.75}
              />
              Interested
            </button>
          </form>
        </>
      )}
      <p className="rsvp-help">
        <Mail aria-hidden="true" size={14} strokeWidth={1.75} />
        Going RSVPs get a confirmation email with a calendar file.
      </p>
    </section>
  );
}
