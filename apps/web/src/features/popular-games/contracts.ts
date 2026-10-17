import * as z from "zod";

const identifierSchema = z.string().trim().min(1).max(200);

export const popularGameDtoSchema = z.object({
  id: identifierSchema,
  name: z.string(),
  slug: identifierSchema,
  cover_url: z.string().optional(),
  upcoming_events: z.number().int().positive(),
});

export const popularGamesResponseSchema = z.object({
  games: z.array(popularGameDtoSchema).max(8),
});

export type PopularGameDTO = z.output<typeof popularGameDtoSchema>;

/** A school slug narrows the list to that school's events. */
export const popularGamesInputSchema = z.object({
  school: z.string().trim().max(200).optional(),
});

export type PopularGamesInput = z.output<typeof popularGamesInputSchema>;

/** An empty or unavailable list hides the panel; it never fails the page. */
export type PopularGamesResult =
  | { status: "ready"; games: PopularGameDTO[] }
  | { status: "unavailable" };
