import * as z from "zod";
import { teamRoleSchema } from "../team-slice/contracts.js";

const identifierSchema = z.string().trim().min(1).max(200);
const nonNegativeIntegerSchema = z.number().int().nonnegative();
const cursorSchema = z.string().trim().min(1).max(2048);

/** People on one full list page. A multiple of 2, 3, and 4 fills the grid. */
export const peoplePageSize = 24;
/** People on an entity page's preview card. */
export const peoplePreviewSize = 8;

/**
 * The only person shape allowed to cross the Start server-function boundary:
 * a name and the labels shown beside it. Zod strips anything else the API adds,
 * so an email or school never reaches a list.
 */
export const personDtoSchema = z.object({
  id: identifierSchema,
  name: z.string(),
  verification_level: identifierSchema,
  role_indicators: z.array(z.string()).optional(),
  /** Present in team lists only. */
  role: teamRoleSchema.optional(),
});

export const peopleListDtoSchema = z.object({
  people: z.array(personDtoSchema),
  limit: nonNegativeIntegerSchema,
  has_more: z.boolean(),
  has_previous: z.boolean(),
  next_cursor: z.string().min(1).optional(),
  previous_cursor: z.string().min(1).optional(),
});

export const eventRSVPListResponseSchema = z.enum(["yes", "maybe"]);

const peoplePageInputSchema = z.object({
  after: cursorSchema.optional(),
  before: cursorSchema.optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

export const eventAttendeesInputSchema = peoplePageInputSchema.extend({
  slug: identifierSchema,
  response: eventRSVPListResponseSchema,
});

export const schoolMembersInputSchema = peoplePageInputSchema.extend({
  slug: identifierSchema,
});

export const teamMembersInputSchema = peoplePageInputSchema.extend({
  slug: identifierSchema,
});

export type PersonDTO = z.output<typeof personDtoSchema>;
export type PeopleListDTO = z.output<typeof peopleListDtoSchema>;
export type EventRSVPListResponse = z.output<
  typeof eventRSVPListResponseSchema
>;
export type EventAttendeesInput = z.output<typeof eventAttendeesInputSchema>;
export type SchoolMembersInput = z.output<typeof schoolMembersInputSchema>;
export type TeamMembersInput = z.output<typeof teamMembersInputSchema>;

/**
 * One list read. Failures are told apart only as far as the page needs: a
 * visitor with no valid session, a list that does not exist (or a private
 * event the viewer has not unlocked), and everything else. No upstream detail
 * is carried.
 */
export type PeopleListResult =
  | { status: "found"; list: PeopleListDTO }
  | { status: "signed_out" }
  | { status: "not_found" }
  | { status: "unavailable" };

export type PeopleSearch = { after?: string; before?: string };

export type EventPeopleSearch = PeopleSearch & {
  response?: EventRSVPListResponse;
};

export function validatePeopleSearch(
  search: Record<string, unknown>,
): PeopleSearch {
  const after = boundedSearchValue(search.after);
  // The API rejects both cursors together, so a hand-edited link keeps one.
  const before = after ? undefined : boundedSearchValue(search.before);

  return {
    ...(after ? { after } : {}),
    ...(before ? { before } : {}),
  };
}

export function validateEventPeopleSearch(
  search: Record<string, unknown>,
): EventPeopleSearch {
  const response = eventRSVPListResponseSchema.safeParse(
    firstValue(search.response),
  );

  return {
    ...(response.success ? { response: response.data } : {}),
    ...validatePeopleSearch(search),
  };
}

/** The loader input for a full page: Going unless the search says Maybe. */
export function eventPeopleInput(
  search: EventPeopleSearch,
): PeopleSearch & { response: EventRSVPListResponse } {
  return {
    response: search.response ?? "yes",
    ...(search.after ? { after: search.after } : {}),
    ...(search.before ? { before: search.before } : {}),
  };
}

function firstValue(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function boundedSearchValue(value: unknown): string | undefined {
  const parsed = cursorSchema.safeParse(firstValue(value));
  return parsed.success ? parsed.data : undefined;
}
