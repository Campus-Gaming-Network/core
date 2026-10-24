# Web design implementation plan

> Open tasks now live in [GitHub Issues](https://github.com/Campus-Gaming-Network/core/issues) and the [CGN core project board](https://github.com/orgs/Campus-Gaming-Network/projects/4). This document remains as reference; its checklists are no longer updated.

This plan translates the approved Campus Gaming Network mockups into the
existing TanStack Start application. It does not expand the product scope in
the source-of-truth product, API, database, permission, or roadmap documents.

## Approved direction

The October 2026 redesign rebuilt every public page on the CGN design handoff
v3 (`CGN_Design_Handoff/STYLE_GUIDE.md` and its reference sheets; sheets 11,
10, and 09 take precedence, then 08 and 12, then 05-07). It changed
presentation only: routes, loaders, server functions, form fields, native
form fallbacks, and permissions are unchanged. Mockup features the product
does not have (clubs, tournament brackets and registration, recruiting,
header search, counts the API does not return) are tracked as issues, not
drawn as placeholders: see #61, #62, #246-#272, and #215-#216.

### Foundation

- Light mode only. Tokens are the first `:root` block of
  `apps/web/src/styles.css` and are listed on `/styleguide`: a `#f8f8f8`
  canvas, white panels, near-black text (`#0b0c0c`), muted text (`#505a5f`),
  hairline borders (`#d8dadb`), control edges at 3:1 or better against white
  (`#6f777b`, and `#767f84` for pills and tags), blue actions (`#0057d9`, `#0046b5` on hover),
  blue underlined links (`#1a68ac`), a yellow focus ring with a near-black
  outer edge, green for success states only, and red for errors and
  destructive actions. A flat navy (`--color-identity`) is the generated
  identity color for banners and team tiles. A school without a logo shows a
  two-letter monogram (`schoolMonogram`) on one of ten pale tones fixed by its
  slug (`schoolTone`, `data-school-tone`). The tones are not the school's
  colors, and none is red or green.
- Spacing is a 4px scale (`--space-1` to `--space-7`); type is 16px body,
  14px secondary, 19px section headings, and 26-32px page titles
  (`--text-*`). Panels use 8px corners, controls and identity tiles 6px, and
  tags 4px. There are no gradients, and shadows only on menus and dialogs.
- A colored edge accent (a current item's left bar, a notice's left edge, the
  calendar tile's red top) always sits on square corners, so it is a straight
  line rather than a curve: the element has no radius on that side.
- Every page's `main` shares one 80rem column and gutter (16px on a phone).

### Shell

- A dark navy header: a blue controller tile, the "CGN" wordmark and
  "Campus Gaming Network" (hidden below 64rem), the global links
  (`SiteNavigation`: Home, Events, Teams, Clubs, Schools; the current one has a 3px
  light-blue underline), and Log in and Sign up or the account menu at the
  right. Below 42rem the links collapse behind a Menu button. Clubs and People
  join the list only when those pages exist (#261, #216). The label stays
  "Schools", matching the routes and data, rather than the mockups'
  "Universities".
- A white footer with the brand, a footer navigation list, and icon links to
  CGN's own social accounts. The accounts are one list in
  `apps/web/src/components/site-social-links.tsx`; an empty list drops the
  icons.

### Patterns

- **Directory pages** (`/events`, `/teams`, `/schools`): `.directory-heading`
  with the h1, a lede, and the page's one action at the right; on events the
  scope tabs; a `FilterToolbar` directly over the results; the results as one
  white panel of `DirectoryRow`s; Previous and Next as small
  secondary buttons. The directories have no left column. The results sit in a
  labelled `DirectoryResults` region: while a filter or page change loads for
  more than 200 ms it is `aria-busy`, softened, with a thin sweep (static under
  reduced motion). After Previous or Next the region scrolls into view and takes
  focus, and "/" outside a text field focuses the first search field.
- **Directory row** (`DirectoryRow`): an identity tile (calendar date, team
  initial, or school logo or monogram; the calendar date is a white tile with a red top
  edge), on event rows the first game's portrait cover at a
  fixed 3:4 size or a controller tile (it stands for the games, so event rows
  list no game names as tags; its alt text names them; team rows show the
  same picture as decoration beside their game tags), the name as a blue underlined link, a
  time line, a muted line with the host and the place's name (the street address is left to the detail page; a school's own page leaves out the host), tags, counts ("0 interested" is left out; school rows show teams, upcoming events, and members, each with an icon, leave out any count that is zero, and show none when they cannot be read; the school page header follows the same rule), and a small blue
  action link with an arrow ("View event →"). The whole row is one link. Event times give the date once for a
  one-day event, the year only outside the current year, and the time zone
  once unless it changes during the event. It lays out by the width of its list: in
  columns from 60rem, the action beside the name from 30rem, and the action
  under the rest below that.
- **Tags** (`StatusLabel`): small tinted labels with no icons. An event's type
  is blue, Free and "Happening now" green, Full red, and audience, games, and
  plain facts neutral gray. The event format is said in the location line.
- **Detail pages** (event, school, team): breadcrumbs, then `DetailHero`
  (a navy band with the logo or initial, the page's one h1 and its supporting
  lines, and at the right either the primary game's portrait cover at its own
  size or the page's actions). Each fact is said once. The event hero holds
  the host and tags; below it a facts block (date with "Add to calendar",
  place with "Get directions", the online link or a note that it is shared
  with people who are going, and going and interested counts) sits beside
  the RSVP panel, and the side card is "Details" (games, repeats). The team
  hero holds the school, location, and games, with the membership panel in
  the side column. The school hero holds the location, website, and Follow. Section `Tabs` link
  to existing pages only (Overview and Going on events; Overview and Members
  on teams; Overview, Events, and Teams on schools). The body is
  `.layout-detail`: a main column of sections and `.panel`s, and a 20rem side
  column of `.detail-card`s led by `KeyInformation`. Below 64rem it is one
  column.
- **Home**: for a signed-in viewer, a left column (`DirectorySidebar`: "Your
  school" and "Schools you follow", long names ending in an ellipsis; no
  section links, since the header is the one global navigation), then a
  welcome panel with three event shortcuts (My school or Find your school,
  Online, Nationwide), then "Events this week" and "More events" beside popular schools, "Popular
  games" (hidden when no game has an upcoming public event), and a "Host
  something" panel. The school page's side column shows "Popular games at
  \<school>" under About, on the same terms. Its header shows the school's teams, upcoming events, and members under the location, leaving out any that are zero, or nothing when the counts cannot be read. A visitor gets no left column. There is no
  marketing hero or "How it works" row.
- **Create and edit forms** (events, teams): breadcrumbs, a sticky numbered
  section nav at the left from 64rem (plain in-page links, not a stepper), and
  one 48rem column with the heading and a sectioned white form whose sections
  are divided by rules. The form ends in an action bar: Cancel at the left and
  the primary action at the right. There is no live preview (#256).
- **Settings and account**: a left "Account settings" nav (Profile, Account,
  Delete account) beside the page, a row of links above it on a phone. Only
  existing sections are listed (#249-#251 track the rest). Deleting the
  account has its own page (`/settings/delete-account`) under a "Danger zone"
  heading: a red-edged panel, a typed DELETE confirmation, and a final dialog;
  a failed native submission returns there.
- **Authentication**: one centered column: h1, lede, a white form panel,
  a full-width blue submit, and secondary links below.
- **Text pages** (About, FAQ, Support, Terms, Privacy): `main.prose` at a
  46rem measure.
- **States**: notices are tinted bars with a colored left edge and an icon;
  `Callout` is a light-blue note with a blue left edge; error summaries are
  red-framed white boxes that link to each invalid field; empty and
  unavailable states are white panels with a heading and actions.

### Images

- Game covers are portrait and are shown only at portrait sizes (row
  thumbnails, the banner, and key information); they are never stretched or
  cropped into a landscape banner.
- School logos show on white tiles when the bundle has one; otherwise the tile is the school's monogram on its pale tone (`SchoolMark`). Teams always show an initial tile
  (#271).
- Essential text and controls are never inside an image.

### States, resilience, and accessibility

- **Route states**: the pending state is a generic skeleton (a heading, a
  filter row, and four directory-row placeholders; the shimmer runs only when
  motion is allowed, and the message stays available to screen readers).
  Error, list-unavailable, and not-found views are `.empty-state` panels with
  a primary and a secondary action. A failure at the root keeps the site
  header and footer (`SiteShell` in the root route).
  A missing event, team, or school slug answers 404 with its own title,
  `noindex`, and next steps (a missing school links to `/schools?q=` with words
  taken from the slug); error views say so when the browser is offline.
- **Images fail soft**: game covers and school logos share
  `useImageFailure`, which also catches failures before hydration, and fall
  back to the controller tile or the initial in a box of the same size. The
  banner cover loads eagerly with a high fetch priority.
- **Accessibility baseline**: axe reports no WCAG 2.1 AA violations on any
  route at 1440 and 390 wide. Standalone links, summaries, checkboxes, and
  radios are at least 24px tall. Forced-colors rules keep tags, the chosen
  RSVP, current tabs and nav items, focus rings, the calendar tile edge, and
  the banner distinguishable, and reduced motion stops animations as well as
  transitions. Running prose is capped at 68ch.
- **Print**: pages print without the header, footer, navigation, forms, and
  buttons; the banner becomes an outlined white box; external links print
  their URL; people lists print in columns; FAQ answers print open (CSS in
  Chromium, a `beforeprint` handler elsewhere).
- **Icons**: a favicon (SVG and PNG), an Apple touch icon, a web manifest, and
  a navy `theme-color` live in `apps/web/public` and are linked from the root
  route.

### Interaction details

- **Directory filters** (`FilterToolbar` in `FilterForm`): search fields,
  then a row of compact filter buttons, each a native select showing the
  filter's name and value ("Format Any"), or a checkbox ("Free only"). An
  applied filter turns blue, and "Clear filters" appears while any is
  applied, so the toolbar is its own summary of what is applied. Schools and
  games are lists that grow into the thousands, so they are never a select:
  events and teams search them (`SearchFilter`), with results under the field
  (each school's logo, each game's cover) and the chosen one shown as a blue
  applied filter with a clear button. The game search asks the catalog by
  name (`GET /games?q=`), and the page names a chosen game with
  `GET /games/:slug`; the whole catalog is never loaded. Schools search by
  name and filter by State. With JavaScript every change applies at once (a
  select or checkbox as it changes, a school or game when chosen or cleared,
  a name search on Enter), focus returns to the control that made it, and
  the results are announced politely. Without JavaScript the toolbar is a
  GET form with an Apply filters button, each search filter is a select of
  the chosen item and search matches, and a "Search schools / Search games"
  form above it loads matches (`school_q`, `game_q`). An empty filtered
  result names the filters and offers to remove the most restrictive one. A
  scope tab fixes its own filter (Online the format, Tournaments the type, My
  school the school): that filter shows as a dashed button with a lock, its
  value is kept in a hidden input, and Clear filters keeps the tab. The tab
  is named in the URL (`scope`), so choosing the same filter under All
  events (Format: Online) stays on All events and leaves the filter editable.
- **Page changes**: after an in-app navigation to a different page,
  `RouteAnnouncer` moves focus to the new page's h1 (without scrolling, so
  scroll restoration still decides) and announces its title politely. The
  first load, search-only changes such as filters, and hash links are left
  alone.
- **Touch targets**: on coarse pointers, header and settings links,
  pagination, text actions, form controls, and checkbox labels are at least
  44px tall, and small icon buttons (a search filter's clear, the notice
  dismiss) get an invisible 44px hit area, so the look does not change. Hover
  effects sit inside `@media (hover: hover)`.
- **No swap on hydration**: a control that needs JavaScript (the search
  filters, the school and game fields on forms) renders its live markup from
  the first paint, and its no-JavaScript fallback sits in `<noscript>`. The
  document head's noscript style hides `.live-only` and shows the toolbar's
  Apply filters button, and a live control's hidden field takes its name only
  after hydration, so exactly one control submits either way. Nothing
  appears and then disappears while a page loads.
- **Long forms**: fields with a length limit show a character count
  (`CharacterCount` through `FormField characterCount`) that counts bytes the
  way the API does, reads "You can enter up to N characters" without
  JavaScript, and announces politely after typing pauses. The section nav
  marks the section in view with `aria-current="location"` (JavaScript only).
  The start and end labels name the chosen time zone.
- **Event page actions**: on devices with the Web Share API, Share opens the
  native sheet; Copy link stays as the fallback with a visible, announced
  confirmation. "Add to calendar (.ics)" is a secondary button under the
  time. Times break only between whole pieces (date, each time, zone). An
  online or hybrid event's "When and where" card shows the meeting link and
  a "Join online" button to people going and to organizers (the API sends
  the link to no one else); others see that the link is shared with people
  who are going. Place text never depends on whether the link is present.
- **Dates**: the calendar tile shows the month, day, and weekday in the
  event's zone, so an event row's text gives only the time ("3:45 PM – 6:45
  PM CDT"), naming the end date only when the event ends on a later day. The
  event page keeps the full date and time. On event rows the tile is the only
  place the date appears, so screen readers read it. An event in progress
  shows a green "Now" there instead of a "Happening now" tag. For an upcoming
  event starting today or tomorrow, the tile's weekday becomes a solid blue
  "Today" or "Tomorrow" label, computed in the event's zone from the moment the
  page was rendered (the root loader's `renderedAt`), which the browser
  hydrates with, so it is in the server HTML and never swaps in late. Counts use thousands
  separators.
- **Event type tags**: Tournament carries a trophy icon, Meeting a
  presentation icon, and Workshop a cog, before the word, on event rows and
  the event page. The word always carries the meaning.

### Second pass (pickers, feedback, flows)

- **Interaction states**: every control uses one 120ms ease transition (none
  under reduced motion). Hover, on pointer devices only, tints neutral
  surfaces `--color-subtle`, and pressed is one step darker; every button
  presses down 1px. Elements whose parent clips them (directory rows, tabs,
  nav items) draw the yellow and black focus ring inside their own box.
  Disabled is `not-allowed` with muted text and a dashed edge, not faded;
  pending (`aria-busy`) shows the wait cursor; an invalid field keeps its 1px
  border plus an inset red ring, so nothing shifts.
- **Pickers**: the game field (`GameSelect`) and the school field
  (`SchoolSearchSelect`) are comboboxes with a listbox (arrow keys, Enter to
  add or choose, Escape to clear). Enter in the search box never submits the
  form. The game field is one search: games already on Campus Gaming Network
  show at once and IGDB results follow after a pause, under group headings,
  each with its portrait cover or the controller tile. Any number of catalog
  games and up to five IGDB games can be added; chosen games are listed with
  their covers and a Remove button. School results and the chosen-school card
  show the school's logo or initial; the card has a Change button. Signup,
  settings, and the team form use the same school field. Submitted field
  names and the no-JavaScript fallbacks are unchanged.
- **Feedback**: a success notice can be dismissed once the page is
  interactive and is announced through a polite status region filled after
  hydration; a failure notice is `role="alert"` and stays. A submitting form
  gets `aria-busy` and a small spinner in its submit button. The error
  summary is the GOV.UK pattern ("There is a problem" and links to fields).
  `ConfirmDialog` starts on the safe action, traps focus, closes on Escape or
  the backdrop (not while saving), locks page scroll, and stacks its buttons
  on phones.
- **Event form**: sections run basics, when, where, games and capacity,
  cost, then visibility. With JavaScript it mirrors the server's rules (end
  after start, the repeat rules, the private password) in
  `event-form-validation.ts`, fills the end time two hours after the start
  until the organizer changes it, and shows payment fields only for Paid;
  without JavaScript the server is the only check.
- **Sign up and log in**: email fields use the email keyboard and no
  autocorrect; password rules are stated up front; signup has no time zone
  field and sends the device's zone in a hidden input (Pacific without
  JavaScript), and settings offers a pick list of time zones; login errors add a next step (reset the
  password, resend verification, wait); expired verification and reset links
  offer a new one.
- **Team page**: the membership panel is titled for the viewer ("Join this
  team" or "Your membership"), and Transfer ownership sits in its own
  red-edged block apart from the captain list.
- **Profiles and account**: profiles never show a filler bio or a raw ID; an
  empty bio is a prompt on your own profile and absent for others, and a
  missing school reads "No home school listed". The account page lists
  upcoming RSVPs, then upcoming events marked "I'm interested", then
  followed-school events, followed schools, and teams. Account empty states
  pair the message with one secondary action.
- **Home and school pages**: the event list rules and the home page's two
  sections are in [01 — Product](./01-product.md#discover). A wordmark logo stays out of square tiles and shows wide in the
  school page's About card.
- **Text pages**: Terms and Privacy show an "On this page" list when a policy
  version defines three or more sections; FAQ links open and scroll to their
  question, and each answer has a copy-link button.

## Shared component inventory

The routes should converge on these reusable pieces as they are migrated. The
status column says which already exist and where.

| Component          | Responsibilities                                                     | Status                                                                                                                                                                                                                                                   |
| ------------------ | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SiteShell`        | Header, navigation, authentication actions, footer, skip link        | Planned as its own component; today it is inline in `apps/web/src/routes/__root.tsx`                                                                                                                                                                     |
| `Breadcrumbs`      | Trail of parent pages ending in the current page                     | Built: `apps/web/src/components/breadcrumbs.tsx`; used on event, school, and team pages                                                                                                                                                                  |
| `PageHeading`      | Identity mark, heading, supporting line, tags, optional actions      | Built for detail pages: `apps/web/src/components/page-heading.tsx`; browse, form, and static routes still repeat the `.page-heading` and `.browse-heading` markup                                                                                        |
| `KeyInformation`   | Description list of an entity's facts in the side panel              | Built: `apps/web/src/components/key-information.tsx`; used on event, school, and team pages                                                                                                                                                              |
| `ButtonLink`       | Primary and secondary router links drawn as buttons                  | Built: `apps/web/src/components/button-link.tsx`                                                                                                                                                                                                         |
| `Button`           | Primary, secondary, quiet, destructive, loading, disabled            | Planned; native `<button>` elements use the `button--secondary` and `button--destructive` classes from `styles.css`                                                                                                                                      |
| `Surface`          | White bounded panel on the canvas                                    | The `.panel` (with `.panel--flush`, `.panel__header`, and `.panel__body`), `.action-panel`, `.empty-state`, and `.detail-card` classes in `styles.css`                                                                                                   |
| `DirectoryRow`     | Identity tile, name, meta line, neutral labels, counts, one action   | Built: `apps/web/src/components/directory-row.tsx`; used by `EventCard` and the team and school directories                                                                                                                                              |
| `FilterToolbar`    | Search fields, filter buttons that show their value, Clear filters   | Built: `apps/web/src/components/filter-toolbar.tsx` (`FilterForm`, `FilterSelect`, `FilterToggle`, `LockedFilter`, `ClearFiltersLink`, `NoScriptFilterSearch`) and `search-filter.tsx` (`SearchFilter`); used on the event, team, and school directories |
| `DirectorySidebar` | Section links, the viewer's home school, and followed schools        | Built: `apps/web/src/components/directory-sidebar.tsx`; used by `/` only, with its data from `loadDirectorySidebar` in `apps/web/src/features/account-slice/account.functions.ts`                                                                        |
| `EventRow`         | Calendar-tile date, lifecycle label, event facts, `View event`       | Built as `EventCard` on `DirectoryRow`: `apps/web/src/features/event-slice/event-card.tsx`; the account dashboard uses `DirectoryRow` too                                                                                                                |
| `DetailHero`       | Navy band with logo or monogram, the h1, and a game cover or actions | Built: `apps/web/src/components/detail-hero.tsx`; used on event, school, and team pages                                                                                                                                                                  |
| `FormSectionNav`   | Numbered, sticky in-page links to a long form's sections             | Built: `apps/web/src/components/form-section-nav.tsx`; used on the event and team forms                                                                                                                                                                  |
| `StatusLabel`      | Text plus color for event, account, invitation, and request state    | Built: `apps/web/src/components/status-label.tsx` as `.tag`: neutral, or `tone` info, success, warning, or danger, with lifecycle tones from `status`                                                                                                    |
| `Avatar`           | Deterministic generated identity with accessible fallback initials   | Built: `apps/web/src/components/avatar.tsx`                                                                                                                                                                                                              |
| `SchoolMark`       | A school's logo on white, or its monogram on its pale tone           | Built: `apps/web/src/components/school-mark.tsx`; monogram and tone from `school-identity.ts`; used in directories, pickers, the sidebar, the account page, profiles, and people pages                                                                   |
| `Tabs`             | Keyboard-accessible local navigation and selected state              | Built: `apps/web/src/components/tabs.tsx` (`Tabs` and `TabLink`); used on the school page, the event attendee page, and the events directory's scope tabs                                                                                                |
| `FormField`        | Label, help text, control, validation text, described-by wiring      | Built: `apps/web/src/components/form-field.tsx` wires the label, control, and validation text; help text stays in the form as a `.form-help` paragraph                                                                                                   |
| `ErrorSummary`     | Page-level failure summary with links to invalid controls            | Built as `FormErrorSummary`: `apps/web/src/components/enhanced-mutation.tsx`                                                                                                                                                                             |
| `RSVPControl`      | Current RSVP plus Going, Maybe, and Can't go choices                 | Planned as a shared component; today `RsvpEventForm` is inline in `apps/web/src/routes/events.$slug.tsx`                                                                                                                                                 |
| `Notice`           | Page-level success, information, warning, and error feedback         | Built as `PageNoticeView`: `apps/web/src/components/page-notice-view.tsx`, covering success and error                                                                                                                                                    |
| `Callout`          | Filled, icon-led note for reassurance or a heads-up (not an alert)   | Built: `apps/web/src/components/callout.tsx` (`info`, `lock`, and `shield` icons, and an optional action beside the note)                                                                                                                                |
| `CalendarDate`     | Calendar-page tile for an event start date (month, day number)       | Built: `apps/web/src/components/calendar-date.tsx`; used by event rows, the account dashboard, and the event page header                                                                                                                                 |
| `Toast`            | Short live-region confirmation for enhanced interactions             | Planned                                                                                                                                                                                                                                                  |
| `Dialog`           | Focus-managed confirmation for destructive or high-impact actions    | Built as `ConfirmDialog`: `apps/web/src/components/confirm-dialog.tsx`                                                                                                                                                                                   |
| `RouteState`       | Loading, empty, unavailable, forbidden, and not-found states         | Built: `apps/web/src/components/route-boundaries.tsx` (`RoutePending`, `RouteErrorView`, `ListUnavailable`, and the default boundaries)                                                                                                                  |

Components must render useful server HTML before hydration. Enhanced controls
must preserve the existing native form fallback.

### Surfaces

Panels and detail cards use `--color-card` (white) with a
`--color-card-border` hairline on the light-gray canvas. The footer and form
controls are white, and the header is navy. Form control edges use
`--color-control-border` (`#6f777b`), because the handoff's `#b1b4b6`
separator gray is below 3:1 against white. A `Callout` is light blue with a
blue left edge.

### Where shared styles live

Styles for a component that renders in more than one route area (the
directory row, identity banner, tabs, breadcrumbs, sidebar, people lists, the
form-page layout, and choice cards) live in `apps/web/src/components.css`.
The root route loads it after `styles.css`, so the component looks the same on
every page. A route area's own stylesheet (`events.css`, `teams.css`,
`account.css`) holds only rules for that area's markup and is linked from that
area's routes. When a component starts rendering in another area, move its
rules into `components.css` rather than adding a stylesheet link to the new
route.

Every rule sits in a cascade layer. `styles.css` declares the order, lowest
to highest: `base` (tokens and bare-element defaults), `components` (the
shell, layouts, and shared components), `features` (a route area's own
sheet), `overrides` (disabled and pending states and touch target sizes,
which no route rule may undo), and `utilities` (single-purpose classes such
as `.visually-hidden` and `.muted`). A later layer wins whatever the
specificity, so a route's sheet overrides a shared component with a plain
class selector. Wrap a new route stylesheet in `@layer features { ... }`; a
rule outside every layer would outrank all of them, and
`apps/web/tests/stylesheet-layers.test.ts` fails if one appears. Rules nest
with native CSS nesting (`&:hover`, `@media` inside a rule); the build
flattens it for older browsers.

### Style guide page

`/styleguide` shows the tokens, type, buttons, forms, and every shared
component and state on one page, each labelled with its component and file, rendered by the real components against made-up fixtures in
`apps/web/src/features/styleguide/fixtures.ts`. It makes no API calls. The
token lists are read from the first `:root` block of `styles.css`, so a new
token appears there without an edit.

The page is reachable in every environment, is marked `noindex`, and is not
linked from the header or footer. When a shared component is added or gains a
variant, add it to `apps/web/src/routes/styleguide.tsx`. The RSVP control is
still route-local markup rather than a component, so the page repeats it and
must be updated by hand when it changes. The school and team rows are `DirectoryRow`, but each route passes its
own fields, so the page repeats those calls.

## Route and state matrix

### Current backend support

These screens can be implemented against existing routes and contracts:

| Experience            | Existing route                       | Required states                                                                                              |
| --------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Public homepage       | `/`                                  | Events/schools available, empty, unavailable                                                                 |
| School directory      | `/schools`                           | Search, filtered, empty, unavailable, pagination                                                             |
| School page           | `/schools/:slug`                     | Active, empty, followed/unfollowed, unavailable                                                              |
| Event discovery       | `/events`                            | Scope tabs, filters, empty, unavailable, lifecycle labels, pagination                                        |
| Event detail          | `/events/:slug`                      | Upcoming, live, full, ended, private/locked, unavailable                                                     |
| Create event          | `/events/new`                        | Default, validation errors, submitting, success                                                              |
| Edit event            | `/events/:slug/edit`                 | Editable, forbidden, validation errors, cancelled; Organizers section for the creator and for a co-organizer |
| Co-organizer invite   | `/organizer-invite`                  | Signed out (to login and back), accept, invalid, wrong account                                               |
| Event attendees       | `/events/:slug/people`               | Going and Maybe tabs, empty, unavailable, pagination                                                         |
| Event updates         | `/events/:slug/activity`             | Editor view with authors, public view, empty, unavailable, pagination; Updates section on the event page     |
| School people         | `/schools/:slug/people`              | Members, empty, unavailable, pagination                                                                      |
| Team people           | `/teams/:slug/people`                | Members with roles, empty, unavailable, pagination                                                           |
| Team directory        | `/teams`                             | Search/filter, empty, unavailable, pagination                                                                |
| Team page             | `/teams/:slug`                       | Public, member, joinable, management controls                                                                |
| Authentication        | `/login`, `/signup`, password routes | Default, validation, pending, recovery, verification                                                         |
| Public profile        | `/users/:public_id`                  | Populated, minimal, unavailable, not found                                                                   |
| Account               | `/account`                           | Dashboard sections, deletion confirmation                                                                    |
| Edit profile          | `/settings/profile`                  | Default, validation, saved, unavailable                                                                      |
| Your data             | `/settings/data`                     | Download (wrong password, rate limited, failed), correction links                                            |
| Notifications         | `/notifications`                     | Unread and read, empty, unavailable, older pages; header bell with an unread count                           |
| Support and reporting | `/support`, event report forms       | Default, validation, submitted, unavailable                                                                  |
| Information pages     | Static routes                        | Normal, not found                                                                                            |

### Existing data that needs a new web surface

- Per-user notifications have persistence foundations, but the product docs
  intentionally defer the authenticated API and inbox UI.
- The dashboard can use existing upcoming RSVP and followed-school activity
  responses before richer invitations or notifications are added.
- The Admin Console already owns moderation operations; public-site moderation
  controls must not be copied into `apps/web`.

### Product and backend expansion required

The following mockups stay as future specifications until their owning source
documents are updated and their contracts are implemented:

- Event waitlists and promotion.
- Attendee administration and event check-in.
- Team invitation links and invitation acceptance.
- Organizer announcements and delivery history.
- Personalized recommendation preferences.
- Member directory discovery preferences.
- Post-event standings, media, recaps, and feedback.
- Connected third-party accounts.
- Organizer-approval workflow.
- User-facing appeal workflow.

## Interaction contracts

### RSVP

- The event header's panel asks "Are you going?" above the choices.
- Choices are one row of three submit buttons: Going (`yes`), Maybe
  (`maybe`), and Can't go (`no`). The chosen one carries `aria-pressed` and is
  filled: Going green, Maybe blue, Can't go gray.
- Going counts toward capacity; Maybe and Can't go do not.
- A full event blocks a new Going response but does not prevent an existing
  Going attendee from changing their response. An ended event disables every
  choice and says RSVPs are closed; the chosen one keeps its fill.
- While a save is pending the buttons are `aria-disabled` rather than
  disabled, so keyboard focus stays on the pressed button. Native form
  submission remains valid.
- "I'm interested" is a separate toggle under the choices.

### People lists

- Signed-in viewers see who is part of an event (Going, with Maybe on its own
  tab; Interested stays a count), a school (home-school members), and a team
  (members with roles): the first eight on the page of the event, school, or
  team, and every page at `/events/:slug/people`, `/schools/:slug/people`, and
  `/teams/:slug/people`. Visitors keep the existing counts and see a log-in
  prompt, and the full pages send them to `/login`. The pages are `noindex`,
  `private, no-store`, and paginated with native Previous and Next links, and a
  list that cannot load leaves the entity page up. Anyone who turned off "Show
  me in member lists" on the Edit profile page is left out.

### Forms

- Preserve entered values on validation failure.
- Render a page-level summary before the first field.
- Repeat each message beside its field and connect it with `aria-describedby`.
- Focus the summary after an enhanced failed submission.
- Loading copy describes the actual action: `Saving…`, `Publishing…`, or
  `Sending…`.

### Dialogs and destructive actions

- Cancellation, deletion, ownership transfer, suspension, and revocation use
  an explicit confirmation step.
- Focus moves into the dialog, stays inside while open, returns to its trigger,
  and closes with Escape unless an irreversible request is pending.

### Notices

- Success confirmations use a polite live region.
- Validation and request failures use `role="alert"` only when newly rendered.
- Color is always paired with a label or explanatory text.

## Responsive acceptance criteria

- No horizontal document overflow at 320 CSS pixels.
- Primary actions remain at least 44 CSS pixels high on coarse pointers.
- Two-column detail layouts stack in reading order: identity, actions, details,
  supporting panels.
- Event rows keep the date, title, status, and `View event` readable without
  truncating the title to an unexplained value.
- Filters wrap or stack; they do not create an internal horizontal scroller.
- Tables use a deliberately responsive row layout or a bounded table scroller.
- Server-rendered controls are not used until hydration and router navigation
  have settled in JavaScript-enabled browser tests.

## Accessibility acceptance criteria

- One `main` landmark and one visible `h1` per route.
- Route changes focus the new page heading.
- Visible focus remains at least as prominent as the yellow and near-black
  focus ring.
- Menus, tabs, dialogs, and form errors are keyboard accessible.
- Status is never expressed by color alone.
- All informative images have useful alternative text; decorative imagery is
  hidden from assistive technology.
- Reduced-motion preferences remove nonessential transitions.
- Automated axe checks and manual keyboard review pass at desktop and mobile
  widths. The standard is WCAG 2.1 level AA: the browser suites for web and
  admin scan with `@axe-core/playwright` using the `wcag2a`, `wcag2aa`,
  `wcag21a`, and `wcag21aa` tags, and any violation of any impact fails.
- A control a keyboard user just pressed is not disabled while its request is
  pending, because that drops focus to the page body. Use `aria-disabled` and
  ignore repeat submits.

## Deterministic design fixtures

Browser tests should cover fixed fixtures for:

- Upcoming, happening-now, full, and ended events.
- An authenticated viewer with Going, Maybe, and No RSVP states.
- Locked and unlocked private events.
- Active and empty schools.
- Populated and empty browse results.
- API-unavailable browse results.
- Valid and invalid create-event submissions.
- Member, captain, organizer, and signed-out views.
- Active, suspended, and deleted-account boundaries where supported.

Fixtures must not depend on the wall clock, random collisions, or test order.

## Delivery sequence

1. **Foundation:** tokens, light-only shell, navigation, buttons, fields,
   surfaces, focus, and responsive rules.
2. **Discovery:** homepage, school directory/pages, event directory, and team
   directory/pages.
3. **Participation:** event detail, private-event gate, Interested, editable
   RSVP, capacity, and account dashboard.
4. **Accounts:** login, signup, recovery, verification, profile, and account
   settings.
5. **Organizer work:** sectioned event form, edit/cancel flows, team creation,
   and team management supported by current APIs.
6. **System quality:** route states, validation summaries, accessibility,
   responsive checks, and screenshot regression coverage.
7. **Future product work:** implement only after the source-of-truth product,
   schema, API, permission, and roadmap documents authorize it.

## Validation for each browser-visible batch

Run, in order:

1. `pnpm run fmt`
2. `pnpm run typecheck:web`
3. `pnpm run lint:web`
4. `pnpm run test:web`
5. `pnpm run build:web`

The Playwright suites (`pnpm run test:e2e:web:dev` and `test:e2e:web`) are
paused while the UI changes quickly; see `CLAUDE.md`. When they resume, the
production suite must run immediately after the production build because it
serves the existing `apps/web/.output` bundle.
