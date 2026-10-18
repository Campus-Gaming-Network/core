import * as z from "zod";
import type { WithSchoolLogo } from "../school-slice/contracts.js";

const identifierSchema = z.string().trim().min(1).max(200);

export const clubTypeSchema = z.enum(["student_club", "university_program"]);

const clubGameSchema = z.object({
  id: identifierSchema,
  name: z.string(),
  slug: identifierSchema,
  has_cover: z.boolean(),
});

// Only http(s) links reach a page; the API enforces the same rule on write.
const clubLinkSchema = z.object({
  type: z.enum(["website", "discord", "social"]),
  label: z.string(),
  url: z
    .string()
    .refine((value) => /^https?:\/\//i.test(value), "Unsafe link."),
});

/** One published club as its page shows it. */
export const clubDtoSchema = z.object({
  id: identifierSchema,
  name: z.string(),
  slug: identifierSchema,
  type: clubTypeSchema,
  summary: z.string(),
  how_to_join: z.string().optional(),
  school: z.object({
    id: identifierSchema,
    name: z.string(),
    slug: identifierSchema,
    city: z.string().optional(),
    state: z.string().optional(),
  }),
  games: z.array(clubGameSchema),
  links: z.array(clubLinkSchema),
  claimed: z.boolean(),
  confirmed_at: z.iso.datetime({ offset: true }).optional(),
  confirmed_source: z.enum(["club", "cgn"]).optional(),
});

/** A school's clubs as the school page lists them. */
export const schoolClubsResponseDtoSchema = z.object({
  clubs: z.array(
    z.object({
      id: identifierSchema,
      name: z.string(),
      slug: identifierSchema,
      type: clubTypeSchema,
      summary: z.string(),
      games: z.array(clubGameSchema),
      claimed: z.boolean(),
    }),
  ),
});

export const clubSlugInputSchema = z.object({ slug: identifierSchema });

export type ClubType = z.output<typeof clubTypeSchema>;
export type ClubDTO = Omit<z.output<typeof clubDtoSchema>, "school"> & {
  school: WithSchoolLogo<z.output<typeof clubDtoSchema>["school"]>;
};
export type SchoolClubDTO = z.output<
  typeof schoolClubsResponseDtoSchema
>["clubs"][number];

export type ClubDetailResult =
  | { status: "found"; club: ClubDTO }
  | { status: "not_found" }
  | { status: "error" };

export type SchoolClubsResult = {
  clubs: SchoolClubDTO[];
  /** True when the list could not be read; the school page says so. */
  unavailable: boolean;
};
