import type { EventDTO } from "../src/features/event-slice/contracts.js";
import type { AccountDashboardResult } from "../src/features/account-slice/contracts.js";
import type { PublicProfileDTO } from "../src/features/public-profile/contracts.js";

export const routeEvent: EventDTO = {
  id: "event-1",
  title: "Private campus night",
  slug: "campus-night",
  description: "Bring a controller.",
  visibility: "private",
  format: "online",
  starts_at: "2037-02-20T02:00:00Z",
  ends_at: "2037-02-20T05:00:00Z",
  timezone: "America/Los_Angeles",
  rsvp_yes_count: 0,
  interest_count: 0,
  lifecycle: "upcoming",
  cost: "free",
  host_school: { id: "school-1", name: "Example University", slug: "example" },
  games: [],
  revision: 0,
  updated_at: "2037-02-01T17:00:00Z",
};

export const routeProfile: PublicProfileDTO = {
  id: "user-1",
  public_id: "public-user",
  name: "Campus Player",
  bio: "Looking for games.",
  verification_level: "basic",
  home_school_id: "school-1",
};

export const routeAccount: Extract<
  AccountDashboardResult,
  { status: "found" }
> = {
  status: "found",
  profile: {
    ...routeProfile,
    email: "player@example.test",
    timezone: "America/Los_Angeles",
    show_in_lists: true,
  },
  dashboardEvents: {
    upcoming_rsvps: [{ ...routeEvent, viewer_rsvp: "yes" }],
    interested_events: [],
    followed_school_events: [],
  },
  followedSchools: [],
  teams: [
    {
      id: "team-1",
      name: "Campus team",
      slug: "campus-team",
      viewer_role: "member",
      member_count: 2,
      games: [],
    },
  ],
  unavailable: { dashboardEvents: false, followedSchools: false, teams: false },
};
