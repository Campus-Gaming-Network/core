import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowRight, CalendarDays, Lock, MapPin, Users } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { AccountMenu } from "../components/account-menu";
import { Avatar } from "../components/avatar";
import { BreadcrumbLink, Breadcrumbs } from "../components/breadcrumbs";
import { ButtonLink } from "../components/button-link";
import {
  ClearFiltersLink,
  FilterSelect,
  FilterToggle,
  FilterToolbar,
  LockedFilter,
} from "../components/filter-toolbar";
import { DetailHero } from "../components/detail-hero";
import { CalendarDate } from "../components/calendar-date";
import { Callout } from "../components/callout";
import { ConfirmDialog } from "../components/confirm-dialog";
import { characterCountMessage } from "../components/character-count-logic";
import { CopyLink } from "../components/copy-link";
import {
  DirectoryRow,
  directoryRowClassName,
} from "../components/directory-row";
import { DirectorySidebar } from "../components/directory-sidebar";
import { FormErrorSummary } from "../components/enhanced-mutation";
import { EventCounts } from "../components/event-counts";
import { FormField, RequiredFieldsNote } from "../components/form-field";
import { FormSection } from "../components/form-section";
import { FormSectionNav } from "../components/form-section-nav";
import { KeyInformation } from "../components/key-information";
import { PageHeading } from "../components/page-heading";
import { PasswordInput } from "../components/password-input";
import { PageNoticeView } from "../components/page-notice-view";
import { Person } from "../components/person";
import { publicPageHead } from "../components/public-page-head";
import { ListUnavailable } from "../components/route-boundaries";
import { SchoolMark } from "../components/school-mark";
import { StatusLabel } from "../components/status-label";
import { TabLink, Tabs } from "../components/tabs";
import accountCSS from "../features/account-slice/account.css?url";
import { EventCard } from "../features/event-slice/event-card";
import { EventFacts } from "../features/event-slice/event-facts";
import { EventGameCover } from "../features/event-slice/event-game-cover";
import { EventGameThumb } from "../features/event-slice/event-game-thumb";
import { EventScopeTabs } from "../features/event-slice/event-scope-tabs";
import eventCSS from "../features/event-slice/events.css?url";
import { eventLifecycleLabel } from "../features/event-slice/presentation";
import {
  brokenImageURL,
  exampleCoverURL,
  exampleDirectorySidebar,
  exampleFilterChips,
  exampleFormSections,
  exampleLogoURL,
  exampleEvents,
  examplePeople,
  exampleSchools,
  exampleTeams,
  exampleTileSchools,
  exampleViewer,
} from "../features/styleguide/fixtures";
import {
  RsvpPanel,
  Specimen,
  SpecimenNote,
} from "../features/styleguide/specimens";
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
  ["page-states", "Page states"],
  ["labels", "Tags"],
  ["marks", "Marks"],
  ["lists", "Lists and cards"],
  ["filters", "Filters"],
  ["navigation", "Navigation"],
  ["detail-header", "Detail page header"],
  ["event-controls", "Event controls"],
  ["danger", "Danger zone and dialog"],
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
        <div>
          <p className="eyebrow">Style guide</p>
          <h1>Every style in the web app, on one page</h1>
          <p className="lede">
            Colors, type, buttons, forms, and the pieces built from them, drawn
            by the same components and stylesheets as the rest of the site. The
            events, schools, and people are made up, so their links lead to
            pages that do not exist. Each specimen is labelled with its
            component and source file. This page makes no API calls and its
            images are inline.
          </p>
          <p className="styleguide-intro">
            A few pieces need the server, a clock, or a full page of their own
            and cannot render here as they do on the site: the RSVP form, the
            404 and error pages, and the Today and Tomorrow tag. Those show
            markup with the same classes, and say so beside them.
          </p>
        </div>
      </section>
      <nav aria-label="Style guide sections" className="styleguide-toc">
        <ul>
          {sections.map(([id, label]) => (
            <li key={id}>
              <a href={`#styleguide-${id}`}>{label}</a>
            </li>
          ))}
        </ul>
      </nav>

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
          <Specimen
            file="src/components/button-link.tsx, styles.css"
            name="ButtonLink, .button--destructive, .link"
          >
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
          </Specimen>
          <Specimen file="styles.css" name="Disabled, .with-arrow">
            <div className="styleguide-row">
              <button className="button--secondary" disabled type="button">
                Saving…
              </button>
              <Link
                className="button button--secondary with-arrow"
                to="/events"
              >
                Browse events
                <ArrowRight aria-hidden="true" size={14} strokeWidth={2.25} />
              </Link>
            </div>
          </Specimen>
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
          <Specimen
            file="src/components/page-notice-view.tsx"
            name="PageNoticeView, success"
          >
            <PageNoticeView
              notice={{ message: "RSVP saved.", severity: "success" }}
            />
          </Specimen>
          <Specimen
            file="src/components/page-notice-view.tsx"
            name="PageNoticeView, danger"
          >
            <PageNoticeView
              notice={{
                message: "We could not save your RSVP. Please try again.",
                severity: "danger",
              }}
            />
          </Specimen>
          <Specimen file="src/components/callout.tsx" name="Callout, info">
            <Callout>
              A yes RSVP gets a confirmation email with a calendar file.
            </Callout>
          </Specimen>
          <Specimen file="src/components/callout.tsx" name="Callout, lock">
            <Callout icon="lock">
              Your email address is never shown on your public profile.
            </Callout>
          </Specimen>
          <Specimen
            file="src/components/callout.tsx"
            name="Callout, shield, with action"
          >
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
          </Specimen>
          <Specimen file="styles.css" name=".empty-state">
            <section className="empty-state">
              <h3>No public events found</h3>
              <p>
                Create the first event for your campus, or{" "}
                <Link to="/events/new">start from the event form</Link>.
              </p>
            </section>
          </Specimen>
        </div>
      </section>

      <PageStatesSection />

      <section
        aria-labelledby="styleguide-labels-title"
        className="section"
        id="styleguide-labels"
      >
        <div className="section-heading">
          <p className="eyebrow">State at a glance</p>
          <h2 id="styleguide-labels-title">Labels</h2>
        </div>
        <p className="styleguide-intro">
          A tag is a short fact or state. The words carry the meaning; the tint
          only reinforces it.
        </p>
        <Specimen
          file="src/components/status-label.tsx"
          name="StatusLabel, tone"
        >
          <div className="tag-list">
            {(["neutral", "info", "success", "warning", "danger"] as const).map(
              (tone) => (
                <StatusLabel key={tone} tone={tone}>
                  {tone}
                </StatusLabel>
              ),
            )}
          </div>
        </Specimen>
        <Specimen
          file="src/components/status-label.tsx"
          name="StatusLabel, status"
        >
          <div className="styleguide-row">
            {(["upcoming", "happening_now", "full", "ended"] as const).map(
              (lifecycle) => (
                <StatusLabel key={lifecycle} status={lifecycle}>
                  {eventLifecycleLabel(lifecycle)}
                </StatusLabel>
              ),
            )}
          </div>
        </Specimen>
        <Specimen
          file="src/features/event-slice/event-facts.tsx"
          name="EventFacts"
        >
          <div className="tag-list">
            <EventFacts
              event={{
                event_type: "tournament",
                audience: "collegiate",
                cost: "free",
              }}
            />
          </div>
        </Specimen>
        <Specimen file="src/components/directory-row.tsx" name="Game tags">
          <div className="tag-list">
            {exampleEvents.map((event) => (
              <StatusLabel key={event.id}>{event.games[0]?.name}</StatusLabel>
            ))}
          </div>
        </Specimen>
        <Specimen
          file="src/components/calendar-date.tsx"
          name="CalendarDate, now, today, and tomorrow"
        >
          <div className="tag-list">
            {["Now", "Today", "Tomorrow"].map((label) => (
              <span
                aria-hidden="true"
                className={
                  label === "Now"
                    ? "calendar-date calendar-date--soon calendar-date--now"
                    : "calendar-date calendar-date--soon"
                }
                key={label}
              >
                <span className="calendar-date__month">Oct</span>
                <span className="calendar-date__day">17</span>
                <span className="calendar-date__weekday">{label}</span>
              </span>
            ))}
          </div>
          <SpecimenNote>
            On event rows the tile swaps its weekday for Now (an event in
            progress, from the API), Today, or Tomorrow. Today and Tomorrow use
            the moment the page was rendered (useEventRelativeDay), so these are
            drawn with fixed text. The rule is in eventRelativeDay
            (presentation.ts).
          </SpecimenNote>
        </Specimen>
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
          Each mark has text underneath its image: initials for a person, a
          two-letter monogram on the school&apos;s tone for a school, the first
          letter for a team. If the image fails, the text shows.
        </p>
        <div className="styleguide-row styleguide-row--marks">
          {(["large", "medium", "small"] as const).map((size) => (
            <div className="styleguide-mark" key={size}>
              <Avatar
                id={exampleViewer.id}
                name={exampleViewer.name}
                size={size}
              />
              <span className="styleguide-label">
                Avatar, {size}
                <br />
                <span className="styleguide-label__file">
                  src/components/avatar.tsx
                </span>
              </span>
            </div>
          ))}
          <div className="styleguide-mark">
            <SchoolMark
              className="school-directory-mark--large"
              name={exampleSchools[0].name}
              size={88}
              slug={exampleSchools[0].slug}
            />
            <span className="styleguide-label">
              School mark, large
              <br />
              <span className="styleguide-label__file">
                src/components/school-mark.tsx
              </span>
            </span>
          </div>
          <div className="styleguide-mark">
            <SchoolMark
              name={exampleSchools[0].name}
              size={44}
              slug={exampleSchools[0].slug}
            />
            <span className="styleguide-label">School mark</span>
          </div>
          <div className="styleguide-mark">
            <SchoolMark
              className="school-directory-mark--large"
              logoURL={exampleLogoURL}
              name={exampleSchools[0].name}
              size={88}
              slug={exampleSchools[0].slug}
            />
            <span className="styleguide-label">
              School mark with a logo
              <br />
              <span className="styleguide-label__file">
                src/components/school-logo.tsx
              </span>
            </span>
          </div>
          <div className="styleguide-mark">
            <SchoolMark
              className="school-directory-mark--large"
              logoURL={brokenImageURL}
              name={exampleSchools[0].name}
              size={88}
              slug={exampleSchools[0].slug}
            />
            <span className="styleguide-label">
              SchoolLogo, failed: the monogram shows
            </span>
          </div>
          <div className="styleguide-mark">
            <span aria-hidden="true" className="team-mark team-mark--large">
              R
            </span>
            <span className="styleguide-label">
              Team mark, large
              <br />
              <span className="styleguide-label__file">.team-mark</span>
            </span>
          </div>
          <div className="styleguide-mark">
            <span aria-hidden="true" className="team-mark">
              R
            </span>
            <span className="styleguide-label">Team mark</span>
          </div>
          <div className="styleguide-mark">
            <EventGameThumb games={[{}]} />
            <span className="styleguide-label">
              EventGameThumb, no cover
              <br />
              <span className="styleguide-label__file">
                src/features/event-slice/event-game-thumb.tsx
              </span>
            </span>
          </div>
          <div className="styleguide-mark">
            <EventGameCover hasCover={false} slug="styleguide" />
            <span className="styleguide-label">
              EventGameCover, no cover
              <br />
              <span className="styleguide-label__file">
                src/features/event-slice/event-game-cover.tsx
              </span>
            </span>
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
                <span className="styleguide-label">
                  CalendarDate, large, with weekday
                  <br />
                  <span className="styleguide-label__file">
                    src/components/calendar-date.tsx
                  </span>
                </span>
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
        <SpecimenNote>
          The event thumbnail and cover load a game&apos;s image through the
          site&apos;s API route, so only the no-cover tile is shown here; it is
          also what a cover that fails to load becomes. An image that cannot
          load is dropped in the same way for the logo (above) and the banner
          cover (under Detail page header).
        </SpecimenNote>
        <h3 className="styleguide-sub">Schools without a logo</h3>
        <p className="styleguide-intro">
          The monogram is the first letters of the first two words that name the
          school, after a leading &ldquo;University of&rdquo; or &ldquo;College
          of the&rdquo;. The tone is one of ten, fixed by the school&apos;s
          slug: not the school&apos;s color, and never red or green.
        </p>
        <Specimen
          file="src/components/school-identity.ts"
          name="SchoolMark, schoolMonogram, schoolTone"
        >
          <ul className="styleguide-tile-row">
            {exampleTileSchools.map((school) => (
              <li key={school.slug}>
                <SchoolMark name={school.name} size={44} slug={school.slug} />
                <span className="styleguide-label">{school.name}</span>
              </li>
            ))}
          </ul>
        </Specimen>
        <h3 className="styleguide-sub">People</h3>
        <Specimen file="src/components/person.tsx" name="Person, .people-list">
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
        </Specimen>
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
          Lists are compact rows on one white panel, split by hairlines, rather
          than grids of cards. Panels group a list or a set of facts under a
          heading.
        </p>

        <p className="styleguide-intro">
          Event, school, and team directories share one row: an identity tile,
          the name, a muted line with the host or school and then the location,
          tags (an event's type in blue, Free in green, then the audience and
          games as neutral tags), counts, and one small blue action. Rows lay
          out by the width of their list: columns when wide, the action beside
          the name in a narrower column, and the action under the rest on a
          phone.
        </p>

        <h3 className="styleguide-sub">Event rows</h3>
        <Specimen
          file="src/features/event-slice/event-card.tsx, src/components/directory-row.tsx"
          name="EventCard, DirectoryRow"
        >
          <div className="list list--panel">
            {exampleEvents.map((event) => (
              <EventCard event={event} key={event.id} />
            ))}
          </div>
        </Specimen>
        <Specimen file="src/components/event-counts.tsx" name="EventCounts">
          <EventCounts going={1240} interested={86} />
        </Specimen>

        <h3 className="styleguide-sub">School rows</h3>
        <p className="styleguide-label">
          DirectoryRow, src/components/directory-row.tsx
        </p>
        <div className="list list--panel">
          {exampleSchools.slice(0, 2).map((school) => (
            <Link
              className={directoryRowClassName}
              key={school.slug}
              params={{ slug: school.slug }}
              to="/schools/$slug"
            >
              <DirectoryRow
                action="View school"
                identity={
                  <span aria-hidden="true" className="school-directory-mark">
                    {school.name.slice(0, 1)}
                  </span>
                }
                meta={[school.shortName, school.location]}
                name={school.name}
              />
            </Link>
          ))}
        </div>

        <h3 className="styleguide-sub">Team rows</h3>
        <p className="styleguide-label">
          DirectoryRow, src/components/directory-row.tsx
        </p>
        <div className="list list--panel">
          {exampleTeams.map((team) => (
            <Link
              className={directoryRowClassName}
              key={team.slug}
              params={{ slug: team.slug }}
              to="/teams/$slug"
            >
              <DirectoryRow
                action="View team"
                counts={
                  <small className="directory-row__count">
                    <Users aria-hidden="true" size={14} strokeWidth={1.75} />
                    {team.members} members
                  </small>
                }
                identity={
                  <span aria-hidden="true" className="team-mark">
                    {team.name.slice(0, 1)}
                  </span>
                }
                meta={[team.school, team.location]}
                name={team.name}
                tags={team.games}
              />
            </Link>
          ))}
        </div>

        <h3 className="styleguide-sub">Panel with a header</h3>
        <p className="styleguide-label">
          .panel--flush, .detail-card (styles.css, components.css)
        </p>
        <div className="styleguide-two">
          <section className="panel panel--flush">
            <div className="panel__header">
              <h2>Events</h2>
              <Link to="/events">View all</Link>
            </div>
            <div className="list directory-list">
              {exampleEvents.slice(0, 2).map((event) => (
                <EventCard event={event} key={event.id} />
              ))}
            </div>
          </section>
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
        </div>
      </section>

      <FiltersSection />
      <NavigationSection />
      <DetailHeaderSection />
      <EventControlsSection />
      <DangerSection />

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

      <h3 className="styleguide-sub">Character count</h3>
      <p className="styleguide-intro">
        Under a long field, the count states the limit. Without JavaScript, and
        on the server, it reads as the limit alone; once the page is interactive
        it follows the text. The API counts bytes, so a multi-byte character
        counts more than once.
      </p>
      <div className="styleguide-two">
        <Specimen
          file="src/components/character-count.tsx, FormField characterCount"
          name="CharacterCount, live (type in it)"
        >
          <form className="form-stack" onSubmit={keepOnPage}>
            <FormField
              characterCount
              errorId="styleguide-about-error"
              label="About"
              optional
            >
              <textarea
                defaultValue="Rocket League and Overwatch on weeknights."
                maxLength={200}
                rows={3}
              />
            </FormField>
          </form>
        </Specimen>
        <Specimen
          file="src/components/character-count-logic.ts"
          name="CharacterCount, static states"
        >
          <div className="styleguide-stack">
            {[
              characterCountMessage(200, null),
              characterCountMessage(200, 42),
              characterCountMessage(200, 207),
            ].map((message) => (
              <span className="character-count" key={message.text}>
                <span
                  className={
                    message.over
                      ? "character-count__hint character-count__hint--over"
                      : "character-count__hint"
                  }
                >
                  {message.text}
                </span>
              </span>
            ))}
          </div>
        </Specimen>
      </div>

      <h3 className="styleguide-sub">Section navigation</h3>
      <p className="styleguide-intro">
        Numbered links to the sections of a long form. With JavaScript the link
        for the section in view is marked as the current location. On the site
        it is a sticky column from the desktop width and hidden below it; it is
        shown here at every width.
      </p>
      <div className="styleguide-two styleguide-two--nav">
        <Specimen
          file="src/components/form-section-nav.tsx"
          name="FormSectionNav"
        >
          <FormSectionNav
            heading="Create event"
            sections={exampleFormSections}
          />
        </Specimen>
        <p className="form-help">
          Its links jump to the three sections of the form below. Scroll the
          form to watch the current link change.
        </p>
      </div>

      <h3 className="styleguide-sub">Sectioned form with choice cards</h3>
      <p className="styleguide-label">
        FormSection, .choice-card (src/components/form-section.tsx,
        components.css)
      </p>
      <form
        className="form-stack sectioned-form event-form"
        onSubmit={keepOnPage}
      >
        <FormSection
          description="What the event is called and when it runs."
          id="styleguide-form-basics"
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
          id="styleguide-form-visibility"
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
        <FormSection
          description="A note guests see before they RSVP."
          id="styleguide-form-limits"
          title="Limits"
        >
          <FormField
            characterCount
            errorId="styleguide-event-notes-error"
            label="Notes for guests"
            optional
          >
            <textarea maxLength={500} rows={3} />
          </FormField>
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

      <h3 className="styleguide-sub">Event scope tabs</h3>
      <p className="styleguide-intro">
        The same tabs over the events directory. Each links to /events with its
        filter; My school shows only to a signed-in viewer with a home school.
      </p>
      <EventScopeTabs
        homeSchool={{ name: "Summit Ridge University", slug: "summit-ridge" }}
        search={{ scope: "tournaments", type: "tournament" }}
      />

      <h3 className="styleguide-sub">Directory sidebar</h3>
      <p className="styleguide-intro">
        The event, team, and school directories open with this column from the
        tablet width up, and the home page shows it beside its events. It holds
        only the viewer's schools: the header is the one global navigation. A
        visitor, or a viewer whose school data could not load, gets no column.
      </p>
      <div className="styleguide-two">
        <div className="styleguide-stack">
          <p className="styleguide-label">Signed in</p>
          <DirectorySidebar sidebar={exampleDirectorySidebar} />
        </div>
        <div className="styleguide-stack">
          <p className="styleguide-label">Visitor</p>
          <p>Nothing: the directory uses the full width.</p>
        </div>
      </div>

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
            supporting={`${team.school} · ${team.games.join(", ")}`}
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
                { term: "Games", value: team.games.join(", ") },
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
            supporting={event.host_school.name}
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

      <h3 className="styleguide-sub">Identity banner</h3>
      <p className="styleguide-intro">
        The generated banner at the top of an event, school, or team page: flat
        navy, the logo or initial, and a game&apos;s portrait cover at its own
        size when there is one. A logo or cover that fails to load is dropped
        and the band keeps its height. It is decorative; the heading below it
        carries the words.
      </p>
      <div className="styleguide-stack">
        <Specimen
          file="src/components/detail-hero.tsx"
          name="DetailHero, event: logo, tags, and cover"
        >
          <DetailHero
            coverURL={exampleCoverURL}
            initial="Summit Ridge University"
            logoURL={exampleLogoURL}
          >
            <h3>Rocket League 3v3 Bracket</h3>
            <p className="detail-hero__meta">
              Hosted by{" "}
              <a href="#styleguide-detail-header">Summit Ridge University</a>
            </p>
            <div className="tag-list">
              <StatusLabel>Tournament</StatusLabel>
              <StatusLabel>Public</StatusLabel>
              <StatusLabel tone="success">Free</StatusLabel>
            </div>
          </DetailHero>
        </Specimen>
        <Specimen
          file="src/components/detail-hero.tsx"
          name="DetailHero, school: actions on the right"
        >
          <DetailHero
            actions={
              <button className="button--primary" type="button">
                Follow school
              </button>
            }
            initial="Summit Ridge University"
          >
            <h3>Summit Ridge University</h3>
            <p className="detail-hero__meta">Boulder, CO</p>
          </DetailHero>
        </Specimen>
        <Specimen
          file="src/components/detail-hero.tsx"
          name="DetailHero, cover and logo fail to load"
        >
          <DetailHero
            coverURL={brokenImageURL}
            initial="Summit Ridge University"
            logoURL={brokenImageURL}
          >
            <h3>Rocket League 3v3 Bracket</h3>
          </DetailHero>
        </Specimen>
        <Specimen
          file="src/components/detail-hero.tsx"
          name="DetailHero, tile (locked event)"
        >
          <DetailHero
            tile={<Lock aria-hidden="true" size={36} strokeWidth={1.75} />}
          >
            <h3>This event is private.</h3>
            <p className="detail-hero__meta">
              Enter the event password to reveal the details.
            </p>
          </DetailHero>
        </Specimen>
      </div>
    </section>
  );
}

function EventControlsSection() {
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
        The RSVP choice is one connected control. Going turns green, Maybe blue,
        and Can&apos;t go a neutral gray. An ended event closes RSVPs, and a
        full event closes Going for anyone who has not already said it.
      </p>
      <SpecimenNote>
        The real RSVP form lives in the event route and posts to a server
        function, so these panels repeat its markup and classes with nothing
        wired up. Only the first one responds to a press.
      </SpecimenNote>
      <div className="styleguide-cards">
        <Specimen
          file="src/routes/events.$slug.tsx (RsvpEventForm)"
          name="RSVP panel, unanswered (press to try)"
        >
          <RsvpPanel interactive />
        </Specimen>
        <Specimen
          file="src/routes/events.$slug.tsx (RsvpEventForm)"
          name="RSVP panel, Going"
        >
          <RsvpPanel answer="yes" />
        </Specimen>
        <Specimen
          file="src/routes/events.$slug.tsx (RsvpEventForm)"
          name="RSVP panel, Maybe"
        >
          <RsvpPanel answer="maybe" />
        </Specimen>
        <Specimen
          file="src/routes/events.$slug.tsx (RsvpEventForm)"
          name="RSVP panel, Can't go"
        >
          <RsvpPanel answer="no" />
        </Specimen>
        <Specimen
          file="src/routes/events.$slug.tsx (RsvpEventForm)"
          name="RSVP panel, ended"
        >
          <RsvpPanel answer="yes" ended />
        </Specimen>
        <Specimen
          file="src/routes/events.$slug.tsx (RsvpEventForm)"
          name="RSVP panel, full"
        >
          <RsvpPanel full />
        </Specimen>
        <Specimen
          file="src/routes/events.$slug.tsx"
          name="RSVP panel, signed out"
        >
          <RsvpPanel signedOut />
        </Specimen>
      </div>

      <h3 className="styleguide-sub">Details and sharing</h3>
      <div className="styleguide-two">
        {event ? (
          <Specimen file="styles.css (.detail-card)" name="Detail card rows">
            <section className="detail-card">
              <h3>When and where</h3>
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
          </Specimen>
        ) : null}
        <Specimen
          file="src/components/copy-link.tsx"
          name="CopyLink, with Share (copy it to try)"
        >
          <div className="detail-card">
            <CopyLink
              label="Share this event"
              shareTitle="Rocket League 3v3 Bracket"
              url="https://example.edu/events/rocket-league-3v3-bracket"
            />
          </div>
          <SpecimenNote>
            Share appears only where the device has a native share sheet; most
            desktop browsers show Copy link alone.
          </SpecimenNote>
        </Specimen>
      </div>
    </section>
  );
}

function FiltersSection() {
  return (
    <section
      aria-labelledby="styleguide-filters-title"
      className="section"
      id="styleguide-filters"
    >
      <div className="section-heading">
        <p className="eyebrow">Narrowing a list</p>
        <h2 id="styleguide-filters-title">Filters</h2>
      </div>
      <p className="styleguide-intro">
        A directory's filters sit in one toolbar over the results: a search
        field, then compact buttons that each show their value. An applied
        filter turns blue, a filter a tab has set shows a lock, and Clear
        filters appears while any is applied. Every button is a native select or
        checkbox, so the toolbar works without JavaScript. When nothing matches,
        the empty state names the filters and offers the quickest way back.
      </p>
      <div className="styleguide-stack">
        <Specimen
          file="src/components/filter-toolbar.tsx"
          name="FilterToolbar, a game applied and a format set by a tab"
        >
          <form onSubmit={keepOnPage}>
            <FilterToolbar
              clear={<ClearFiltersLink to="/events" />}
              label="Example filters"
              search={
                <div className="filter-search">
                  <label
                    className="visually-hidden"
                    htmlFor="styleguide-filter-search"
                  >
                    Search schools
                  </label>
                  <input
                    id="styleguide-filter-search"
                    placeholder="Search by school name"
                    type="search"
                  />
                  <button className="filter-search__submit" type="submit">
                    Search
                  </button>
                </div>
              }
            >
              <FilterSelect
                label="Game"
                name="game"
                options={[{ value: "valorant", label: "Valorant" }]}
                value="valorant"
              />
              <LockedFilter
                label="Format"
                name="format"
                reason="the Online tab"
                value="online"
                valueLabel="Online"
              />
              <FilterSelect
                label="Type"
                name="type"
                options={[{ value: "tournament", label: "Tournament" }]}
              />
              <FilterToggle
                checked={false}
                label="Free only"
                name="cost"
                value="free"
              />
            </FilterToolbar>
          </form>
        </Specimen>
        <Specimen
          file="src/routes/events.index.tsx"
          name="Empty state with filters"
        >
          <section className="empty-state">
            <h3>No public events found</h3>
            <p>Nothing matches Game: Valorant, Type: Tournament.</p>
            <div className="actions">
              <ButtonLink
                search={exampleFilterChips[0]?.search}
                to="/events"
                variant="primary"
              >
                Remove {exampleFilterChips[0]?.text}
              </ButtonLink>
              <ButtonLink to="/events" variant="secondary">
                Clear all filters
              </ButtonLink>
            </div>
          </section>
        </Specimen>
      </div>
      <SpecimenNote>
        On a directory the toolbar sits in FilterForm
        (src/components/filter-toolbar.tsx), which applies each change at once;
        Apply filters shows only without JavaScript. Schools and games are
        searched, never listed, with SearchFilter
        (src/components/search-filter.tsx).
      </SpecimenNote>
    </section>
  );
}

function PageStatesSection() {
  return (
    <section
      aria-labelledby="styleguide-page-states-title"
      className="section"
      id="styleguide-page-states"
    >
      <div className="section-heading">
        <p className="eyebrow">Loading and failing</p>
        <h2 id="styleguide-page-states-title">Page states</h2>
      </div>
      <p className="styleguide-intro">
        What a page shows while it loads, when it fails, and when it is not
        there.
      </p>
      <SpecimenNote>
        These pages are whole routes (a main landmark, a heading, and in the 404
        case the page title), so rendering them inside this page would nest
        landmarks and change its title. The specimens repeat their markup and
        classes from src/components/route-boundaries.tsx. ListUnavailable is the
        real component.
      </SpecimenNote>
      <div className="styleguide-stack">
        <Specimen
          file="src/components/route-boundaries.tsx"
          name="RoutePending (skeleton)"
        >
          <div aria-hidden="true" className="route-pending">
            <div className="route-pending__shapes">
              <div className="route-pending__bar route-pending__bar--title" />
              <div className="route-pending__bar route-pending__bar--lede" />
              <div className="route-pending__filters">
                <div className="route-pending__bar route-pending__bar--field" />
                <div className="route-pending__bar route-pending__bar--field" />
                <div className="route-pending__bar route-pending__bar--button" />
              </div>
              <div className="route-pending__list">
                {[0, 1, 2].map((row) => (
                  <div className="route-pending__row" key={row}>
                    <div className="route-pending__bar route-pending__bar--tile" />
                    <div className="route-pending__lines">
                      <div className="route-pending__bar route-pending__bar--name" />
                      <div className="route-pending__bar route-pending__bar--detail" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Specimen>
        <Specimen
          file="src/components/route-boundaries.tsx"
          name="RouteErrorView"
        >
          <div className="route-state">
            <section className="empty-state route-state__panel">
              <p className="route-state__kicker">Something went wrong</p>
              <h3>We could not load this page.</h3>
              <p>
                This is usually temporary. Try again, and contact support if it
                keeps happening.
              </p>
              <div className="actions">
                <button className="button button--primary" type="button">
                  Try again
                </button>
                <Link className="button button--secondary" to="/">
                  Go home
                </Link>
                <Link to="/support">Contact support</Link>
              </div>
            </section>
          </div>
        </Specimen>
        <Specimen
          file="src/components/route-boundaries.tsx"
          name="DefaultNotFound (404)"
        >
          <div className="route-state">
            <section className="empty-state route-state__panel">
              <p className="route-state__kicker">404</p>
              <h3>We could not find that page.</h3>
              <p>
                The link may be broken, or the event, team, or school may have
                been removed.
              </p>
              <div className="actions">
                <Link className="button button--primary" to="/">
                  Go home
                </Link>
                <Link className="button button--secondary" to="/events">
                  Browse events
                </Link>
                <Link to="/schools">Browse schools</Link>
                <Link to="/teams">Browse teams</Link>
              </div>
            </section>
          </div>
        </Specimen>
        <Specimen
          file="src/components/route-boundaries.tsx"
          name="ListUnavailable"
        >
          <ListUnavailable heading="Events are unavailable right now" />
        </Specimen>
      </div>
    </section>
  );
}

function DangerSection() {
  const [open, setOpen] = useState(false);
  const openButton = useRef<HTMLButtonElement>(null);

  return (
    <section
      aria-labelledby="styleguide-danger-title"
      className="section"
      id="styleguide-danger"
    >
      <div className="section-heading">
        <p className="eyebrow">Confirming</p>
        <h2 id="styleguide-danger-title">Danger zone and dialog</h2>
      </div>
      <p className="styleguide-intro">
        Destructive actions ask first. The danger zone sets an irreversible
        action apart behind a typed confirmation, and a native dialog asks one
        last time with focus on the safe choice.
      </p>
      <SpecimenNote>
        The delete-account form sends a real request when submitted, so the
        specimen repeats the markup of
        src/features/account-slice/delete-account-form.tsx with nothing wired
        up.
      </SpecimenNote>
      <div className="styleguide-stack">
        <Specimen
          file="src/features/account-slice/delete-account-form.tsx"
          name="Danger zone"
        >
          <section
            aria-labelledby="styleguide-danger-zone-title"
            className="danger-zone"
          >
            <h3 id="styleguide-danger-zone-title">Danger zone</h3>
            <div className="danger-zone__body">
              <h4>Delete your account</h4>
              <p>
                This removes your profile, followed schools, and RSVPs and
                cannot be undone. An upcoming event you created passes to
                another organizer; without one it is cancelled.
              </p>
              <form className="form-stack sectioned-form" onSubmit={keepOnPage}>
                <FormSection
                  description="Your email address becomes available for a new account afterwards."
                  title="Confirm deletion"
                >
                  <FormField
                    errorId="styleguide-delete-error"
                    label="Type DELETE to confirm"
                  >
                    <input autoComplete="off" />
                  </FormField>
                </FormSection>
                <div className="form-actions">
                  <button className="button--destructive" type="submit">
                    Delete account
                  </button>
                </div>
              </form>
            </div>
          </section>
        </Specimen>
        <Specimen
          file="src/components/confirm-dialog.tsx"
          name="ConfirmDialog (press to open)"
        >
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
                Everyone who answered going or maybe gets an email. This cannot
                be undone.
              </p>
            </ConfirmDialog>
          </form>
        </Specimen>
      </div>
    </section>
  );
}
