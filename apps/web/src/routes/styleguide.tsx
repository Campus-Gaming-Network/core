import { Link, createFileRoute } from "@tanstack/react-router";
import {
  ArrowRight,
  CalendarDays,
  Check,
  CircleHelp,
  MapPin,
  Star,
  X,
} from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { AccountMenu } from "../components/account-menu";
import { Avatar } from "../components/avatar";
import { BreadcrumbLink, Breadcrumbs } from "../components/breadcrumbs";
import { ButtonLink } from "../components/button-link";
import { CalendarDate } from "../components/calendar-date";
import { Callout } from "../components/callout";
import { ConfirmDialog } from "../components/confirm-dialog";
import { CopyLink } from "../components/copy-link";
import { FormErrorSummary } from "../components/enhanced-mutation";
import { FormField, RequiredFieldsNote } from "../components/form-field";
import { FormSection } from "../components/form-section";
import { KeyInformation } from "../components/key-information";
import { PageHeading } from "../components/page-heading";
import { PasswordInput } from "../components/password-input";
import { PageNoticeView } from "../components/page-notice-view";
import { Person } from "../components/person";
import { publicPageHead } from "../components/public-page-head";
import { StatusLabel } from "../components/status-label";
import { TabLink, Tabs } from "../components/tabs";
import accountCSS from "../features/account-slice/account.css?url";
import type { EventRSVP } from "../features/event-slice/contracts";
import { EventCard } from "../features/event-slice/event-card";
import { EventFacts } from "../features/event-slice/event-facts";
import eventCSS from "../features/event-slice/events.css?url";
import {
  eventLifecycleLabel,
  eventRSVPLabel,
} from "../features/event-slice/presentation";
import {
  exampleEvents,
  examplePeople,
  exampleSchools,
  exampleTeams,
  exampleViewer,
} from "../features/styleguide/fixtures";
import styleguideCSS from "../features/styleguide/styleguide.css?url";
import { designTokens } from "../features/styleguide/tokens";
import teamCSS from "../features/team-slice/teams.css?url";
import appCSSSource from "../styles.css?raw";

const description =
  "The colors, type, buttons, forms, and components of the Campus Gaming Network web app.";

// Read from the stylesheet itself, so the lists cannot drift from it.
const tokens = designTokens(appCSSSource);
const colorTokens = tokens.filter((token) => token.name.startsWith("--color-"));
const radiusTokens = tokens.filter((token) =>
  token.name.startsWith("--radius-"),
);
const shadowTokens = tokens.filter((token) =>
  token.name.startsWith("--shadow-"),
);

const sections = [
  ["colors", "Colors"],
  ["typography", "Typography"],
  ["buttons", "Buttons"],
  ["forms", "Forms"],
  ["notices", "Notices"],
  ["labels", "Labels"],
  ["marks", "Marks"],
  ["lists", "Lists and cards"],
  ["navigation", "Navigation"],
  ["detail-header", "Detail page header"],
  ["event-controls", "Event controls"],
  ["dialog", "Dialog"],
  ["disclosure", "Disclosure"],
] as const;

const visibilityOptions = [
  {
    value: "public",
    label: "Public",
    hint: "Listed for everyone and open to RSVP.",
  },
  {
    value: "unlisted",
    label: "Unlisted",
    hint: "Hidden from lists. Anyone with the link can view.",
  },
  {
    value: "private",
    label: "Private",
    hint: "Guests need the event password.",
  },
] as const;

const rsvpIcons = { maybe: CircleHelp, no: X, yes: Check } as const;

export const Route = createFileRoute("/styleguide")({
  loader: ({ context }) => context.publicOrigin,
  head: ({ loaderData }) => {
    const head = publicPageHead(loaderData, {
      title: "Style guide",
      description,
      path: "/styleguide",
    });
    return {
      // A reference page for people working on the site, not a destination.
      meta: [...head.meta, { name: "robots", content: "noindex" }],
      links: [eventCSS, teamCSS, accountCSS, styleguideCSS].map((href) => ({
        rel: "stylesheet",
        href,
      })),
    };
  },
  component: StyleguidePage,
});

// The forms here are specimens: they show the controls and send nothing.
function keepOnPage(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
}

function StyleguidePage() {
  const firstEvent = exampleEvents[0];

  return (
    <main className="styleguide-page">
      <section className="page-heading">
        <p className="eyebrow">Style guide</p>
        <h1>Every style in the web app, on one page.</h1>
        <p className="lede">
          Colors, type, buttons, forms, and the pieces built from them, drawn by
          the same components and stylesheets as the rest of the site. The
          events, schools, and people are made up, so their links lead to pages
          that do not exist.
        </p>
        <nav aria-label="Style guide sections" className="account-nav">
          {sections.map(([id, label]) => (
            <a href={`#styleguide-${id}`} key={id}>
              {label}
            </a>
          ))}
        </nav>
      </section>

      <section
        aria-labelledby="styleguide-colors-title"
        className="section"
        id="styleguide-colors"
      >
        <div className="section-heading">
          <p className="eyebrow">Tokens</p>
          <h2 id="styleguide-colors-title">Colors</h2>
        </div>
        <p className="styleguide-intro">
          A warm paper canvas, near-black text, one blue for actions, and a
          yellow accent for the brand mark and the current-page underline. Green
          and red are reserved for state. The site has one light theme.
        </p>
        <ul className="styleguide-swatches" data-tokens="color">
          {colorTokens.map((token) => (
            <li key={token.name}>
              <span
                className="styleguide-chip"
                style={{ background: `var(${token.name})` }}
              />
              <code className="styleguide-label">{token.name}</code>
              <small>{token.value}</small>
            </li>
          ))}
        </ul>

        <h3 className="styleguide-sub">Corners</h3>
        <ul className="styleguide-swatches" data-tokens="radius">
          {radiusTokens.map((token) => (
            <li key={token.name}>
              <span
                className="styleguide-chip styleguide-chip--shape"
                style={{ borderRadius: `var(${token.name})` }}
              />
              <code className="styleguide-label">{token.name}</code>
              <small>{token.value}</small>
            </li>
          ))}
        </ul>

        <h3 className="styleguide-sub">Shadows</h3>
        <ul className="styleguide-swatches" data-tokens="shadow">
          {shadowTokens.map((token) => (
            <li key={token.name}>
              <span
                className="styleguide-chip styleguide-chip--shape"
                style={{ boxShadow: `var(${token.name})` }}
              />
              <code className="styleguide-label">{token.name}</code>
              <small>{token.value}</small>
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-labelledby="styleguide-typography-title"
        className="section"
        id="styleguide-typography"
      >
        <div className="section-heading">
          <p className="eyebrow">Type</p>
          <h2 id="styleguide-typography-title">Typography</h2>
        </div>
        <p className="styleguide-intro">
          One sans family at heavy weights, with tight tracking on headings. The
          title of this page is the standard page heading; the home page hero
          sets its heading one step larger.
        </p>
        <div className="styleguide-spec">
          <p className="styleguide-label">.eyebrow</p>
          <div>
            <p className="eyebrow">Your campus is playing</p>
          </div>
        </div>
        <div className="styleguide-spec">
          <p className="styleguide-label">.section-heading h2</p>
          <div className="section-heading">
            <h2>Events around campus</h2>
          </div>
        </div>
        <div className="styleguide-spec">
          <p className="styleguide-label">.lede</p>
          <div>
            <p className="lede">
              Discover tournaments, casual meetups, and teams at schools near
              you. Everything you need to show up and play is in one place.
            </p>
          </div>
        </div>
        <div className="styleguide-spec">
          <p className="styleguide-label">body</p>
          <div>
            <p>
              The calendar fills up when someone hosts the first event. Create
              one for your campus, or start a team to organize players around
              it.
            </p>
          </div>
        </div>
        <div className="styleguide-spec">
          <p className="styleguide-label">.form-help</p>
          <div>
            <p className="form-help">
              Fields are required unless marked optional.
            </p>
          </div>
        </div>
        <div className="styleguide-spec">
          <p className="styleguide-label">a</p>
          <div>
            <p>
              New here? <Link to="/signup">Create a free account</Link> to RSVP
              and follow your campus.
            </p>
          </div>
        </div>
        <div className="styleguide-spec">
          <p className="styleguide-label">.back-link</p>
          <div>
            <Link className="back-link" to="/events">
              Back to events
            </Link>
          </div>
        </div>
      </section>

      <section
        aria-labelledby="styleguide-buttons-title"
        className="section"
        id="styleguide-buttons"
      >
        <div className="section-heading">
          <p className="eyebrow">Actions</p>
          <h2 id="styleguide-buttons-title">Buttons</h2>
        </div>
        <p className="styleguide-intro">
          The primary button sits on a 4px ledge and presses down into it. Every
          variant dims on hover and shows a 3px blue ring on keyboard focus.
        </p>
        <div className="styleguide-stack">
          <div className="styleguide-row">
            <ButtonLink to="/events" variant="primary">
              Explore events
            </ButtonLink>
            <ButtonLink to="/schools" variant="secondary">
              Find your school
            </ButtonLink>
            <button className="button--destructive" type="button">
              Cancel event
            </button>
            <Link className="link" to="/teams/new">
              Or start a team
            </Link>
          </div>
          <div className="styleguide-row">
            <button className="button--secondary" disabled type="button">
              Saving…
            </button>
            <Link className="button button--secondary with-arrow" to="/events">
              Browse events
              <ArrowRight aria-hidden="true" size={14} strokeWidth={2.25} />
            </Link>
          </div>
        </div>
      </section>

      <FormsSection />

      <section
        aria-labelledby="styleguide-notices-title"
        className="section"
        id="styleguide-notices"
      >
        <div className="section-heading">
          <p className="eyebrow">Feedback</p>
          <h2 id="styleguide-notices-title">Notices</h2>
        </div>
        <p className="styleguide-intro">
          A banner reports the result of an action, with an icon so the state
          never rests on color alone. A callout is a quieter note that is not an
          alert.
        </p>
        <div className="styleguide-stack">
          <PageNoticeView
            notice={{ message: "RSVP saved.", severity: "success" }}
          />
          <PageNoticeView
            notice={{
              message: "We could not save your RSVP. Please try again.",
              severity: "danger",
            }}
          />
          <Callout>
            A yes RSVP gets a confirmation email with a calendar file.
          </Callout>
          <Callout icon="lock">
            Your email address is never shown on your public profile.
          </Callout>
          <Callout
            action={
              <ButtonLink to="/login" variant="secondary">
                Log in
              </ButtonLink>
            }
            icon="shield"
          >
            Log in to RSVP and follow this campus.
          </Callout>
          <section className="empty-state">
            <h3>No public events found</h3>
            <p>
              Try clearing filters or{" "}
              <Link to="/events/new">create the first event</Link> for your
              campus.
            </p>
          </section>
        </div>
      </section>

      <section
        aria-labelledby="styleguide-labels-title"
        className="section"
        id="styleguide-labels"
      >
        <div className="section-heading">
          <p className="eyebrow">State at a glance</p>
          <h2 id="styleguide-labels-title">Labels</h2>
        </div>
        <h3 className="styleguide-sub">Event lifecycle</h3>
        <div className="styleguide-row">
          {(["upcoming", "happening_now", "full", "ended"] as const).map(
            (lifecycle) => (
              <StatusLabel key={lifecycle} status={lifecycle}>
                {eventLifecycleLabel(lifecycle)}
              </StatusLabel>
            ),
          )}
        </div>
        <h3 className="styleguide-sub">Event facts</h3>
        <div className="event-pill-list">
          <EventFacts
            event={{
              format: "in_person",
              event_type: "tournament",
              audience: "collegiate",
              cost: "free",
            }}
          />
        </div>
        <h3 className="styleguide-sub">Game chips</h3>
        <div className="pill-list">
          {exampleEvents.map((event) => (
            <span key={event.id}>{event.games[0]?.name}</span>
          ))}
        </div>
      </section>

      <section
        aria-labelledby="styleguide-marks-title"
        className="section"
        id="styleguide-marks"
      >
        <div className="section-heading">
          <p className="eyebrow">People, schools, dates</p>
          <h2 id="styleguide-marks-title">Marks</h2>
        </div>
        <p className="styleguide-intro">
          Each mark has text underneath its image: initials for a person, the
          first letter for a school or team. If the image fails, the text shows.
        </p>
        <div className="styleguide-row styleguide-row--marks">
          {(["large", "medium", "small"] as const).map((size) => (
            <div className="styleguide-mark" key={size}>
              <Avatar
                id={exampleViewer.id}
                name={exampleViewer.name}
                size={size}
              />
              <span className="styleguide-label">Avatar, {size}</span>
            </div>
          ))}
          <div className="styleguide-mark">
            <span
              aria-hidden="true"
              className="school-directory-mark school-directory-mark--large"
            >
              S
            </span>
            <span className="styleguide-label">School mark, large</span>
          </div>
          <div className="styleguide-mark">
            <span aria-hidden="true" className="school-directory-mark">
              S
            </span>
            <span className="styleguide-label">School mark</span>
          </div>
          <div className="styleguide-mark">
            <span aria-hidden="true" className="team-mark team-mark--large">
              R
            </span>
            <span className="styleguide-label">Team mark, large</span>
          </div>
          <div className="styleguide-mark">
            <span aria-hidden="true" className="team-mark">
              R
            </span>
            <span className="styleguide-label">Team mark</span>
          </div>
          {firstEvent ? (
            <>
              <div className="styleguide-mark">
                <span className="styleguide-calendar styleguide-calendar--large">
                  <CalendarDate
                    size="large"
                    startsAt={firstEvent.starts_at}
                    timezone={firstEvent.timezone}
                  />
                </span>
                <span className="styleguide-label">CalendarDate, large</span>
              </div>
              <div className="styleguide-mark">
                <span className="styleguide-calendar">
                  <CalendarDate
                    startsAt={firstEvent.starts_at}
                    timezone={firstEvent.timezone}
                  />
                </span>
                <span className="styleguide-label">CalendarDate</span>
              </div>
            </>
          ) : null}
        </div>
        <h3 className="styleguide-sub">People</h3>
        <ul className="people-list">
          {examplePeople.map((person) => (
            <li key={person.id}>
              <Person
                detail={person.detail}
                id={person.id}
                name={person.name}
              />
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-labelledby="styleguide-lists-title"
        className="section"
        id="styleguide-lists"
      >
        <div className="section-heading">
          <p className="eyebrow">Browsing</p>
          <h2 id="styleguide-lists-title">Lists and cards</h2>
          <Link to="/events">Browse all events</Link>
        </div>
        <p className="styleguide-intro">
          Lists are rows on the canvas split by hairlines. Boxed cards are kept
          for things that stand alone: a campus tile, a step, a facts panel.
        </p>

        <h3 className="styleguide-sub">Event rows</h3>
        <div className="list">
          {exampleEvents.map((event) => (
            <EventCard event={event} key={event.id} />
          ))}
        </div>

        <h3 className="styleguide-sub">Campus cards</h3>
        <div className="card-grid">
          {exampleSchools.map((school) => (
            <Link
              className="card card--default school-card"
              key={school.slug}
              params={{ slug: school.slug }}
              to="/schools/$slug"
            >
              <span aria-hidden="true" className="school-directory-mark">
                {school.name.slice(0, 1)}
              </span>
              <span>{school.name}</span>
              <small>{school.location}</small>
            </Link>
          ))}
        </div>

        <h3 className="styleguide-sub">Directory rows</h3>
        <div className="school-directory-grid">
          {exampleSchools.slice(0, 2).map((school) => (
            <Link
              className="card card--default school-directory-card"
              key={school.slug}
              params={{ slug: school.slug }}
              to="/schools/$slug"
            >
              <span aria-hidden="true" className="school-directory-mark">
                {school.name.slice(0, 1)}
              </span>
              <span className="school-directory-copy">
                <strong>{school.name}</strong>
                <small>{school.location}</small>
              </span>
              <span className="school-directory-action with-arrow">
                View school
                <ArrowRight aria-hidden="true" size={14} strokeWidth={2.25} />
              </span>
            </Link>
          ))}
        </div>

        <h3 className="styleguide-sub">Team rows</h3>
        <div className="list discovery-list">
          {exampleTeams.map((team) => (
            <Link
              className="card card--default list-item team-discovery-row"
              key={team.slug}
              params={{ slug: team.slug }}
              to="/teams/$slug"
            >
              <span aria-hidden="true" className="team-mark">
                {team.name.slice(0, 1)}
              </span>
              <span className="team-discovery-copy">
                <strong>{team.name}</strong>
                <small>{team.games}</small>
                <small>{team.school}</small>
              </span>
              <span className="team-member-count">{team.members} members</span>
              <span className="discovery-row__action with-arrow">
                View team
                <ArrowRight aria-hidden="true" size={14} strokeWidth={2.25} />
              </span>
            </Link>
          ))}
        </div>

        <h3 className="styleguide-sub">Steps</h3>
        <ol className="steps">
          <li className="card step">
            <h3>Find your school</h3>
            <p>Search the directory and follow your campus.</p>
          </li>
          <li className="card step">
            <h3>Browse events</h3>
            <p>Filter by game or format.</p>
          </li>
          <li className="card step">
            <h3>RSVP</h3>
            <p>Say yes, maybe, or no.</p>
          </li>
          <li className="card step">
            <h3>Start a team</h3>
            <p>Pick your games and share a join password.</p>
          </li>
        </ol>

        <h3 className="styleguide-sub">Detail card and action panel</h3>
        <div className="styleguide-two">
          <section className="detail-card">
            <h2>Event details</h2>
            <div className="detail-row">
              <span>Host</span>
              <span className="detail-value">
                Summit Ridge University
                <small>Boulder, CO</small>
              </span>
            </div>
            <div className="detail-row">
              <span>Game</span>
              <span>Rocket League</span>
            </div>
            <div className="detail-row">
              <span>Capacity</span>
              <span>48 of 48 spots taken</span>
            </div>
          </section>
          <section className="action-panel">
            <p className="eyebrow">Start the scene</p>
            <h2>Not seeing activity for your campus yet?</h2>
            <p>The calendar fills up when someone hosts the first event.</p>
            <div className="actions">
              <ButtonLink to="/events/new" variant="primary">
                Create an event
              </ButtonLink>
              <Link className="link" to="/teams/new">
                Or start a team
              </Link>
            </div>
          </section>
        </div>
      </section>

      <NavigationSection />
      <DetailHeaderSection />
      <EventControlsSection />
      <DialogSection />

      <section
        aria-labelledby="styleguide-disclosure-title"
        className="section"
        id="styleguide-disclosure"
      >
        <div className="section-heading">
          <p className="eyebrow">Open on request</p>
          <h2 id="styleguide-disclosure-title">Disclosure</h2>
        </div>
        <div className="faq-group">
          <details open>
            <summary>Who can create an event?</summary>
            <p>
              Anyone with an account. The event is hosted by the school you pick
              when you create it.
            </p>
          </details>
          <details>
            <summary>What is a private event?</summary>
            <p>
              Guests unlock a private event with the password its organizer
              shares.
            </p>
          </details>
        </div>
        <details className="safety-details">
          <summary>Report this event</summary>
          <form className="form-stack report-form" onSubmit={keepOnPage}>
            <label>
              What is wrong?
              <textarea rows={3} />
            </label>
            <button type="submit">Send report</button>
          </form>
        </details>
      </section>
    </main>
  );
}

function FormsSection() {
  const summaryRef = useRef<HTMLDivElement>(null);
  const fieldErrors = {
    title: ["Title is required."],
    capacity: ["Capacity must be at least 2."],
  };

  return (
    <section
      aria-labelledby="styleguide-forms-title"
      className="section"
      id="styleguide-forms"
    >
      <div className="section-heading">
        <p className="eyebrow">Input</p>
        <h2 id="styleguide-forms-title">Forms</h2>
      </div>
      <p className="styleguide-intro">
        Native controls on a white panel. Forms mark the optional fields, list
        errors at the top, and repeat each error under its field. Nothing here
        is sent.
      </p>

      <div className="styleguide-two">
        <form className="form-stack" onSubmit={keepOnPage}>
          <RequiredFieldsNote />
          <FormField errorId="styleguide-name-error" label="Name">
            <input defaultValue={exampleViewer.name} type="text" />
          </FormField>
          <FormField errorId="styleguide-email-error" label="Email">
            <input placeholder="you@school.edu" type="email" />
          </FormField>
          <FormField errorId="styleguide-school-error" label="School">
            <select>
              {exampleSchools.map((school) => (
                <option key={school.slug}>{school.name}</option>
              ))}
            </select>
          </FormField>
          <FormField errorId="styleguide-bio-error" label="Bio" optional>
            <textarea rows={3} />
          </FormField>
          <label className="checkbox-field">
            <input defaultChecked type="checkbox" />
            Show my school on my public profile
          </label>
          <button type="submit">Save profile</button>
        </form>

        <form className="form-stack" onSubmit={keepOnPage}>
          <FormErrorSummary
            fieldErrors={fieldErrors}
            fieldIds={{
              title: "styleguide-title-error",
              capacity: "styleguide-capacity-error",
            }}
            message="Check the highlighted fields."
            summaryRef={summaryRef}
          />
          <FormField
            errorId="styleguide-title-error"
            errors={fieldErrors.title}
            label="Title"
          >
            <input type="text" />
          </FormField>
          <FormField
            errorId="styleguide-capacity-error"
            errors={fieldErrors.capacity}
            label="Capacity"
          >
            <input defaultValue={1} type="number" />
          </FormField>
          <p role="status">Draft saved.</p>
          <button type="submit">Save event</button>
        </form>
      </div>

      <h3 className="styleguide-sub">Filter bar</h3>
      <form className="search-bar" onSubmit={keepOnPage}>
        <label>
          Game
          <select>
            <option>All games</option>
            {exampleEvents.map((event) => (
              <option key={event.id}>{event.games[0]?.name}</option>
            ))}
          </select>
        </label>
        <label>
          Format
          <select>
            <option>Any format</option>
            <option>In person</option>
            <option>Online</option>
          </select>
        </label>
        <button type="submit">Filter</button>
      </form>

      <h3 className="styleguide-sub">Sectioned form with choice cards</h3>
      <form
        className="form-stack sectioned-form event-form"
        onSubmit={keepOnPage}
      >
        <FormSection
          description="What the event is called and when it runs."
          title="Basics"
        >
          <FormField errorId="styleguide-event-title-error" label="Title">
            <input defaultValue="Rocket League 3v3 Bracket" type="text" />
          </FormField>
          <div className="split-fields">
            <FormField errorId="styleguide-starts-error" label="Starts">
              <input defaultValue="2026-10-23T18:00" type="datetime-local" />
            </FormField>
            <FormField errorId="styleguide-ends-error" label="Ends">
              <input defaultValue="2026-10-23T21:00" type="datetime-local" />
            </FormField>
          </div>
        </FormSection>
        <FormSection
          description="Private events unlock with a password you share."
          title="Who can see it"
        >
          <fieldset className="choice-group">
            <legend>Visibility</legend>
            <div className="choice-cards">
              {visibilityOptions.map((option) => (
                <label className="choice-card" key={option.value}>
                  <input
                    defaultChecked={option.value === "public"}
                    name="visibility"
                    type="radio"
                    value={option.value}
                  />
                  <span className="choice-card-title">{option.label}</span>
                  <span className="choice-card-hint">{option.hint}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="event-private-password">
            <FormField
              errorId="styleguide-password-error"
              label="Event password"
            >
              <PasswordInput />
            </FormField>
            <p className="form-help">
              This box is highlighted while Private is selected.
            </p>
          </div>
        </FormSection>
        <div className="form-actions">
          <button type="submit">Create event</button>
        </div>
      </form>
    </section>
  );
}

function NavigationSection() {
  const [tab, setTab] = useState("Overview");

  return (
    <section
      aria-labelledby="styleguide-navigation-title"
      className="section"
      id="styleguide-navigation"
    >
      <div className="section-heading">
        <p className="eyebrow">Getting around</p>
        <h2 id="styleguide-navigation-title">Navigation</h2>
      </div>
      <p className="styleguide-intro">
        The yellow accent marks the current header link, and a blue underline
        marks the current tab. A signed-in header swaps Log in and Sign up for
        the account menu.
      </p>

      <h3 className="styleguide-sub">Signed-in header</h3>
      <div className="site-header">
        <span className="brand">
          <span aria-hidden="true" className="brand-mark">
            C
          </span>
          <span>Campus Gaming</span>
        </span>
        <nav aria-label="Signed-in navigation example">
          <Link to="/schools">Schools</Link>
          <Link to="/events">Events</Link>
          <Link to="/teams">Teams</Link>
          <AccountMenu
            logoutError=""
            logoutPending={false}
            onLogout={keepOnPage}
            viewer={exampleViewer}
          />
        </nav>
      </div>

      <h3 className="styleguide-sub">Tabs</h3>
      <Tabs label="Tabs example">
        {["Overview", "Events", "Teams"].map((label) => (
          <TabLink
            current={tab === label}
            hash="styleguide-navigation"
            key={label}
            onClick={() => setTab(label)}
            to="/styleguide"
          >
            {label}
          </TabLink>
        ))}
      </Tabs>

      <h3 className="styleguide-sub">Account rows</h3>
      <ul className="account-rows">
        {exampleSchools.slice(0, 2).map((school) => (
          <li key={school.slug}>
            <Link
              className="account-row"
              params={{ slug: school.slug }}
              to="/schools/$slug"
            >
              <strong>{school.name}</strong>
              <small>{school.location}</small>
            </Link>
          </li>
        ))}
      </ul>

      <h3 className="styleguide-sub">Pagination</h3>
      <nav aria-label="Pagination example" className="pagination">
        <a href="#styleguide-navigation">Previous</a>
        <span>Page 2</span>
        <a href="#styleguide-navigation">Next</a>
      </nav>

      <h3 className="styleguide-sub">Copy link</h3>
      <div className="detail-card">
        <CopyLink
          label="Share this event"
          url="https://example.edu/events/rocket-league-3v3-bracket"
        />
      </div>
    </section>
  );
}

function DetailHeaderSection() {
  const team = exampleTeams[0];
  const event = exampleEvents[1];

  return (
    <section
      aria-labelledby="styleguide-detail-header-title"
      className="section"
      id="styleguide-detail-header"
    >
      <div className="section-heading">
        <p className="eyebrow">Event, school, and team pages</p>
        <h2 id="styleguide-detail-header-title">Detail page header</h2>
      </div>
      <p className="styleguide-intro">
        Breadcrumbs, then the heading: an identity mark, the title, a supporting
        line, tags, and actions on the right (below the title on a phone). Key
        information sits in the side panel. On a real page the title is the
        page&apos;s h1; here it is an h2.
      </p>

      {team ? (
        <>
          <h3 className="styleguide-sub">Team</h3>
          <Breadcrumbs current={team.name}>
            <BreadcrumbLink to="/teams">Teams</BreadcrumbLink>
          </Breadcrumbs>
          <PageHeading
            actions={
              <ButtonLink to="/login" variant="primary">
                Log in to join
              </ButtonLink>
            }
            identity={
              <span aria-hidden="true" className="team-mark team-mark--large">
                {team.name.slice(0, 1)}
              </span>
            }
            level={2}
            supporting={`${team.school} · ${team.games}`}
            title={team.name}
          />
          <Tabs label="Team sections example">
            <TabLink current hash="styleguide-detail-header" to="/styleguide">
              Overview
            </TabLink>
            <TabLink
              current={false}
              hash="styleguide-detail-header"
              to="/styleguide"
            >
              Members
            </TabLink>
          </Tabs>
          <h3 className="styleguide-sub">Key information</h3>
          <div className="styleguide-side-panel">
            <KeyInformation
              facts={[
                { term: "Games", value: team.games },
                { term: "School", value: team.school },
                { term: "Members", value: team.members },
              ]}
            />
          </div>
        </>
      ) : null}

      {event ? (
        <>
          <h3 className="styleguide-sub">Event, with tags</h3>
          <PageHeading
            identity={
              <CalendarDate
                size="large"
                startsAt={event.starts_at}
                timezone={event.timezone}
              />
            }
            level={2}
            supporting={`Hosted by ${event.host_school.name}`}
            tags={
              <>
                <StatusLabel>Public</StatusLabel>
                <EventFacts event={event} />
              </>
            }
            title={event.title}
          />
        </>
      ) : null}
    </section>
  );
}

function EventControlsSection() {
  const [rsvp, setRSVP] = useState<EventRSVP>("yes");
  const [interested, setInterested] = useState(false);
  const event = exampleEvents[1];

  return (
    <section
      aria-labelledby="styleguide-event-controls-title"
      className="section"
      id="styleguide-event-controls"
    >
      <div className="section-heading">
        <p className="eyebrow">On an event page</p>
        <h2 id="styleguide-event-controls-title">Event controls</h2>
      </div>
      <p className="styleguide-intro">
        The RSVP choice is one connected control. Yes turns green, Maybe blue,
        and No a neutral gray.
      </p>
      <div className="styleguide-two">
        <section className="detail-card rsvp-card">
          <h2>Your RSVP</h2>
          <div className="detail-card-body">
            <p className="rsvp-current">
              You answered <strong>{eventRSVPLabel(rsvp)}</strong>.
            </p>
            <form className="rsvp-form" onSubmit={keepOnPage}>
              <div
                aria-label="Example RSVP"
                className="rsvp-buttons"
                role="group"
              >
                {(["yes", "maybe", "no"] as const).map((response) => {
                  const RsvpIcon = rsvpIcons[response];
                  return (
                    <button
                      aria-pressed={rsvp === response}
                      key={response}
                      onClick={() => setRSVP(response)}
                      type="button"
                      value={response}
                    >
                      <RsvpIcon aria-hidden="true" size={16} strokeWidth={2} />
                      {eventRSVPLabel(response)}
                    </button>
                  );
                })}
              </div>
            </form>
            <form className="interest-form" onSubmit={keepOnPage}>
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
          </div>
        </section>
        {event ? (
          <section className="detail-card">
            <h2>When and where</h2>
            <div className="detail-card-row">
              <CalendarDays aria-hidden="true" size={18} strokeWidth={1.75} />
              <div>
                <strong>Friday, October 23</strong>
                <small>{event.timezone.replaceAll("_", " ")}</small>
              </div>
            </div>
            <div className="detail-card-row">
              <MapPin aria-hidden="true" size={18} strokeWidth={1.75} />
              <div>
                <strong>Online</strong>
                <small>The link is shared with people who RSVP yes.</small>
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </section>
  );
}

function DialogSection() {
  const [open, setOpen] = useState(false);
  const openButton = useRef<HTMLButtonElement>(null);

  return (
    <section
      aria-labelledby="styleguide-dialog-title"
      className="section"
      id="styleguide-dialog"
    >
      <div className="section-heading">
        <p className="eyebrow">Confirming</p>
        <h2 id="styleguide-dialog-title">Dialog</h2>
      </div>
      <p className="styleguide-intro">
        Destructive actions ask first, in a native dialog. Focus starts on the
        safe choice.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setOpen(false);
        }}
      >
        <button
          className="button--destructive"
          onClick={() => setOpen(true)}
          ref={openButton}
          type="button"
        >
          Cancel event
        </button>
        <ConfirmDialog
          confirmLabel="Cancel event"
          heading="Cancel this event?"
          onClose={() => setOpen(false)}
          open={open}
          returnFocusRef={openButton}
        >
          <p>
            Everyone who answered yes or maybe gets an email. This cannot be
            undone.
          </p>
        </ConfirmDialog>
      </form>
    </section>
  );
}
