import * as z from "zod";

const identifierSchema = z.string().min(1);
const timestampSchema = z.iso.datetime({ offset: true });
const nonNegativeIntegerSchema = z.number().int().nonnegative();

export const schoolSchema = z.object({
  id: identifierSchema,
  unitid: z.number().int().optional(),
  name: z.string(),
  alias: z.string().optional(),
  slug: z.string().min(1),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  website_url: z.string().optional(),
  latitude: z.number().finite().optional(),
  longitude: z.number().finite().optional(),
  is_main_campus: z.boolean(),
  num_branches: nonNegativeIntegerSchema
});

export const schoolSummarySchema = schoolSchema.pick({
  id: true,
  name: true,
  slug: true,
  city: true,
  state: true
});

export const schoolsResponseSchema = z.object({
  schools: z.array(schoolSchema),
  limit: nonNegativeIntegerSchema,
  offset: nonNegativeIntegerSchema
});

export const followedSchoolsResponseSchema = z.object({
  schools: z.array(schoolSchema)
});

export const gameSchema = z.object({
  id: identifierSchema,
  name: z.string(),
  slug: z.string().min(1),
  cover_url: z.string().optional()
});

export const gameSummarySchema = gameSchema.pick({
  id: true,
  name: true,
  slug: true
});

export const gamesResponseSchema = z.object({
  games: z.array(gameSchema)
});

export const eventVisibilitySchema = z.enum([
  "public",
  "unlisted",
  "private"
]);

export const eventFormatSchema = z.enum([
  "online",
  "in_person",
  "hybrid"
]);

export const eventLifecycleSchema = z.enum([
  "upcoming",
  "happening_now",
  "ended",
  "full"
]);

export const eventRSVPSchema = z.enum(["yes", "maybe", "no"]);

export const recurrenceRuleSchema = z.enum([
  "weekly",
  "biweekly",
  "monthly"
]);

export const eventOrganizerSchema = z.object({
  id: identifierSchema,
  name: z.string(),
  role: z.enum(["creator", "organizer"]),
  role_indicators: z.array(z.string()).optional()
});

export const eventSchema = z.object({
  id: identifierSchema,
  title: z.string(),
  slug: z.string().min(1),
  description: z.string(),
  visibility: eventVisibilitySchema,
  format: eventFormatSchema,
  starts_at: timestampSchema,
  ends_at: timestampSchema,
  timezone: z.string().min(1),
  location_name: z.string().optional(),
  address: z.string().optional(),
  online_url: z.string().optional(),
  capacity: z.number().int().positive().optional(),
  rsvp_yes_count: nonNegativeIntegerSchema,
  interest_count: nonNegativeIntegerSchema,
  lifecycle: eventLifecycleSchema,
  recurrence_rule: recurrenceRuleSchema.optional(),
  recurrence_until: timestampSchema.optional(),
  is_paid: z.boolean(),
  payment_note: z.string().optional(),
  payment_url: z.string().optional(),
  host_school: schoolSummarySchema,
  games: z.array(gameSummarySchema),
  organizers: z.array(eventOrganizerSchema).optional(),
  viewer_rsvp: eventRSVPSchema.optional(),
  viewer_interested: z.boolean().optional(),
  viewer_can_edit: z.boolean().optional()
});

export const lockedEventSchema = z.object({
  slug: z.string().min(1),
  visibility: z.literal("private"),
  locked: z.literal(true)
});

export const eventDetailSchema = z.union([eventSchema, lockedEventSchema]);

export const eventsResponseSchema = z.object({
  events: z.array(eventSchema),
  limit: nonNegativeIntegerSchema,
  offset: nonNegativeIntegerSchema
});

export const dashboardEventsResponseSchema = z.object({
  upcoming_rsvps: z.array(eventSchema),
  followed_school_events: z.array(eventSchema)
});

export const teamRoleSchema = z.enum(["owner", "captain", "member"]);

export const teamMemberSchema = z.object({
  user_id: identifierSchema,
  name: z.string(),
  role: teamRoleSchema
});

export const teamSchema = z.object({
  id: identifierSchema,
  name: z.string(),
  slug: z.string().min(1),
  description: z.string(),
  owner_user_id: identifierSchema,
  member_count: nonNegativeIntegerSchema,
  school: schoolSummarySchema.optional(),
  games: z.array(gameSummarySchema),
  viewer_role: teamRoleSchema.optional(),
  members: z.array(teamMemberSchema).optional()
});

export const teamsResponseSchema = z.object({
  teams: z.array(teamSchema),
  limit: nonNegativeIntegerSchema,
  offset: nonNegativeIntegerSchema
});

export const myTeamsResponseSchema = z.object({
  teams: z.array(teamSchema),
  limit: nonNegativeIntegerSchema
});

export const eventUnlockResponseSchema = z.object({
  event: eventSchema,
  unlock_token: z.string().min(1),
  expires_at: timestampSchema
});

export const socialLinkSchema = z.object({
  id: identifierSchema.optional(),
  label: z.string(),
  url: z.string()
});

export const profileSchema = z.object({
  id: identifierSchema,
  email: z.email(),
  email_verified_at: timestampSchema.optional(),
  verification_level: z.string().min(1),
  name: z.string(),
  avatar_url: z.string().optional(),
  bio: z.string().optional(),
  timezone: z.string().min(1),
  home_school_id: identifierSchema,
  home_school: schoolSummarySchema.optional(),
  social_links: z.array(socialLinkSchema).optional(),
  role_indicators: z.array(z.string()).optional()
});

export const publicProfileSchema = z.object({
  id: identifierSchema,
  name: z.string(),
  avatar_url: z.string().optional(),
  bio: z.string().optional(),
  verification_level: z.string().min(1),
  home_school_id: identifierSchema,
  home_school: schoolSummarySchema.optional(),
  social_links: z.array(socialLinkSchema).optional(),
  role_indicators: z.array(z.string()).optional()
});

export const statusResponseSchema = z.object({
  status: z.string().min(1)
});

export const idResponseSchema = z.object({
  id: identifierSchema
});

export const emptyResponseSchema = z.undefined();

export type School = z.infer<typeof schoolSchema>;
export type SchoolSummary = z.infer<typeof schoolSummarySchema>;
export type SchoolsResponse = z.infer<typeof schoolsResponseSchema>;
export type FollowedSchoolsResponse = z.infer<
  typeof followedSchoolsResponseSchema
>;
export type Game = z.infer<typeof gameSchema>;
export type GameSummary = z.infer<typeof gameSummarySchema>;
export type GamesResponse = z.infer<typeof gamesResponseSchema>;
export type EventVisibility = z.infer<typeof eventVisibilitySchema>;
export type EventFormat = z.infer<typeof eventFormatSchema>;
export type EventLifecycle = z.infer<typeof eventLifecycleSchema>;
export type EventRSVP = z.infer<typeof eventRSVPSchema>;
export type EventOrganizer = z.infer<typeof eventOrganizerSchema>;
export type Event = z.infer<typeof eventSchema>;
export type LockedEvent = z.infer<typeof lockedEventSchema>;
export type EventDetail = z.infer<typeof eventDetailSchema>;
export type EventsResponse = z.infer<typeof eventsResponseSchema>;
export type DashboardEventsResponse = z.infer<
  typeof dashboardEventsResponseSchema
>;
export type TeamRole = z.infer<typeof teamRoleSchema>;
export type TeamMember = z.infer<typeof teamMemberSchema>;
export type Team = z.infer<typeof teamSchema>;
export type TeamsResponse = z.infer<typeof teamsResponseSchema>;
export type MyTeamsResponse = z.infer<typeof myTeamsResponseSchema>;
export type EventUnlockResponse = z.infer<typeof eventUnlockResponseSchema>;
export type SocialLink = z.infer<typeof socialLinkSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type PublicProfile = z.infer<typeof publicProfileSchema>;
