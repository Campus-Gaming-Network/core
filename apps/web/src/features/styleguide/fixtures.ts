import {
  activeFilterChips,
  type AppliedFilter,
} from "../../components/directory-filters";
import type { DirectorySidebarResult } from "../account-slice/contracts";
import type {
  EventBrowseItemDTO,
  NavigationViewer,
} from "../event-slice/contracts";

/**
 * Made-up records for the style guide. None of them exist in the API, so a
 * link built from one leads to a not-found page.
 */
export const exampleViewer: NavigationViewer = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Maya Okafor",
};

export const examplePeople: { id: string; name: string; detail: string }[] = [
  { ...exampleViewer, detail: "Owner · Summit Ridge University" },
  {
    id: "00000000-0000-4000-8000-000000000002",
    name: "Diego Ramos",
    detail: "Captain · Summit Ridge University",
  },
  {
    id: "00000000-0000-4000-8000-000000000003",
    name: "Priya Nair",
    detail: "Member · Summit Ridge University",
  },
];

export const exampleSchools: {
  name: string;
  shortName?: string;
  slug: string;
  location: string;
}[] = [
  {
    name: "Summit Ridge University",
    shortName: "SRU",
    slug: "styleguide-summit-ridge",
    location: "Boulder, CO",
  },
  {
    name: "Lakeshore State College",
    slug: "styleguide-lakeshore-state",
    location: "Duluth, MN",
  },
  {
    name: "Harbor Point Institute",
    slug: "styleguide-harbor-point",
    location: "Portland, ME",
  },
  {
    name: "Quiet Valley College",
    slug: "styleguide-quiet-valley",
    location: "Asheville, NC",
  },
];

/** A signed-in viewer's directory sidebar: more follows than it lists. */
export const exampleDirectorySidebar: DirectorySidebarResult = {
  status: "found",
  homeSchool: {
    id: "styleguide-school-summit-ridge",
    name: "Summit Ridge University",
    slug: "styleguide-summit-ridge",
    city: "Boulder",
    state: "CO",
  },
  followedSchools: [
    {
      id: "styleguide-school-lakeshore-state",
      name: "Lakeshore State College",
      slug: "styleguide-lakeshore-state",
    },
    {
      id: "styleguide-school-harbor-point",
      name: "Harbor Point Institute",
      slug: "styleguide-harbor-point",
    },
  ],
  moreFollowedSchools: true,
};

export const exampleTeams: {
  name: string;
  slug: string;
  games: string[];
  school: string;
  location: string;
  members: number;
}[] = [
  {
    name: "Ridge Rocketeers",
    slug: "styleguide-ridge-rocketeers",
    games: ["Rocket League", "Overwatch 2"],
    school: "Summit Ridge University",
    location: "Boulder, CO",
    members: 12,
  },
  {
    name: "Lakeshore Tacticians",
    slug: "styleguide-lakeshore-tacticians",
    games: ["Valorant"],
    school: "Lakeshore State College",
    location: "Duluth, MN",
    members: 7,
  },
];

/** One event in each lifecycle state, so every status label is on the page. */
export const exampleEvents: EventBrowseItemDTO[] = [
  {
    id: "00000000-0000-4000-8000-000000000011",
    title: "Smash Weeklies",
    slug: "styleguide-smash-weeklies",
    format: "in_person",
    event_type: "game_night",
    starts_at: "2026-10-12T18:00:00-06:00",
    ends_at: "2026-10-12T22:00:00-06:00",
    timezone: "America/Denver",
    location_name: "Student Union, Room 204",
    lifecycle: "happening_now",
    cost: "free",
    host_school: {
      name: "Summit Ridge University",
      slug: "styleguide-summit-ridge",
    },
    games: [{ name: "Super Smash Bros. Ultimate" }],
    rsvp_yes_count: 24,
    interest_count: 9,
  },
  {
    id: "00000000-0000-4000-8000-000000000012",
    title: "Rocket League 3v3 Bracket",
    slug: "styleguide-rocket-league-bracket",
    format: "online",
    audience: "collegiate",
    event_type: "tournament",
    starts_at: "2026-10-23T18:00:00-05:00",
    ends_at: "2026-10-23T21:00:00-05:00",
    timezone: "America/Chicago",
    lifecycle: "full",
    cost: "unspecified",
    host_school: {
      name: "Lakeshore State College",
      slug: "styleguide-lakeshore-state",
    },
    games: [{ name: "Rocket League" }],
    rsvp_yes_count: 48,
    interest_count: 31,
  },
  {
    id: "00000000-0000-4000-8000-000000000013",
    title: "Valorant Scrim Night",
    slug: "styleguide-valorant-scrims",
    format: "hybrid",
    audience: "campus",
    event_type: "tryout",
    starts_at: "2026-11-05T19:00:00-05:00",
    ends_at: "2026-11-05T22:00:00-05:00",
    timezone: "America/New_York",
    location_name: "Esports Lab",
    lifecycle: "upcoming",
    cost: "free",
    host_school: {
      name: "Harbor Point Institute",
      slug: "styleguide-harbor-point",
    },
    games: [{ name: "Valorant" }],
    rsvp_yes_count: 11,
    interest_count: 6,
  },
  {
    id: "00000000-0000-4000-8000-000000000014",
    title: "Stardew Co-op Social",
    slug: "styleguide-stardew-social",
    format: "online",
    audience: "open",
    event_type: "meeting",
    starts_at: "2026-09-18T20:00:00-04:00",
    ends_at: "2026-09-18T22:00:00-04:00",
    timezone: "America/New_York",
    lifecycle: "ended",
    cost: "free",
    host_school: {
      name: "Quiet Valley College",
      slug: "styleguide-quiet-valley",
    },
    games: [{ name: "Stardew Valley" }],
    rsvp_yes_count: 16,
    interest_count: 4,
  },
];

const svgImage = (body: string, width: number, height: number) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`,
  )}`;

/** Inline images, so no specimen requests an image or calls the API. */
export const exampleLogoURL = svgImage(
  '<rect width="88" height="88" fill="#1d3a6e"/><text x="44" y="58" font-size="40" font-weight="700" text-anchor="middle" fill="#fff" font-family="sans-serif">S</text>',
  88,
  88,
);
export const exampleCoverURL = svgImage(
  '<rect width="84" height="112" fill="#e8a317"/><circle cx="42" cy="46" r="22" fill="#1d3a6e"/><rect x="14" y="82" width="56" height="8" fill="#1d3a6e"/>',
  84,
  112,
);
/** Decodes as nothing, so the image fires its error event and fails soft. */
export const brokenImageURL = "data:image/png;base64,AAAA";

/** Filters as a directory holds them when two are applied. */
export const exampleFilters: AppliedFilter[] = [
  { key: "game", name: "Game", value: "valorant", label: "Valorant" },
  { key: "type", name: "Type", value: "tournament", label: "Tournament" },
];
export const exampleFilterChips = activeFilterChips(exampleFilters);

/** The sections of the long-form nav specimen. */
export const exampleFormSections = [
  { id: "styleguide-form-basics", label: "Event basics" },
  { id: "styleguide-form-visibility", label: "Who can see it" },
  { id: "styleguide-form-limits", label: "Limits" },
];

/**
 * Schools without a logo for the tile specimen: "University of" and "College
 * of the" names, a campus, and a Spanish name, so each monogram rule shows.
 */
export const exampleTileSchools: { name: string; slug: string }[] = [
  { name: "Summit Ridge University", slug: "summit-ridge" },
  { name: "University of Northern Plains", slug: "northern-plains" },
  { name: "Lakeshore State College", slug: "lakeshore-state" },
  { name: "College of the Pines", slug: "college-of-the-pines" },
  { name: "Harbor Point Institute of Technology", slug: "harbor-point" },
  { name: "Quiet Valley Community College", slug: "quiet-valley" },
  { name: "Universidad del Valle Verde", slug: "valle-verde" },
  { name: "Cedar Bluff College-North Campus", slug: "cedar-bluff-north" },
  { name: "Saint Brendan University", slug: "saint-brendan" },
  { name: "Red Mesa Technical College", slug: "red-mesa" },
];
